// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// RitualHiddenBountyJudge
// -----------------------
// Advanced track for the Ritual bounty judge homework.
// Plaintext answers never hit the chain. Participants encrypt for the TEE's
// pubkey, push the ciphertext to off-chain storage, and only post a hash +
// reference here. The Ritual TEE then pulls everything, decrypts in-enclave,
// batches a single LLM call, and posts the judgment hash back.
//
// The contract trusts:
//   - the bounty owner (for payout)
//   - the pre-registered TEE executor (for judgment integrity)
//   - keccak hashes anchoring everything off-chain
contract RitualHiddenBountyJudge {
    struct Bounty {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint64 submissionDeadline;
        uint64 judgingDeadline;
        address teeExecutor;
        bytes32 teePubkeyHash;
        bool judged;
        bool finalized;
        bool refunded;
        bytes32 judgmentHash;
        string judgmentRef;
        uint256 winnerIndex;
    }

    struct Submission {
        address participant;
        bytes32 commitment;
        bytes32 payloadHash;
        string payloadRef;
        uint64 submittedAt;
        bool invalidated;
    }

    uint256 private constant NO_WINNER = type(uint256).max;

    Bounty[] private bounties;
    mapping(uint256 => Submission[]) private subs;
    mapping(uint256 => mapping(address => bool)) private submitted;

    bool private locked;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        uint256 reward,
        uint64 submissionDeadline,
        uint64 judgingDeadline,
        address teeExecutor,
        bytes32 teePubkeyHash
    );
    event SubmissionPosted(
        uint256 indexed bountyId,
        address indexed participant,
        uint256 indexed index,
        bytes32 commitment,
        bytes32 payloadHash,
        string payloadRef
    );
    event BatchJudged(
        uint256 indexed bountyId,
        bytes32 judgmentHash,
        string judgmentRef,
        uint256 submissionCount
    );
    event WinnerFinalized(
        uint256 indexed bountyId,
        uint256 indexed winnerIndex,
        address indexed winner,
        uint256 amount
    );
    event BountyRefunded(uint256 indexed bountyId, address indexed owner, uint256 amount);
    event SubmissionInvalidatedByTEE(uint256 indexed bountyId, uint256 indexed index);

    modifier exists(uint256 bountyId) {
        require(bountyId < bounties.length, "no bounty");
        _;
    }

    modifier onlyOwner(uint256 bountyId) {
        require(msg.sender == bounties[bountyId].owner, "not owner");
        _;
    }

    modifier onlyTEE(uint256 bountyId) {
        require(msg.sender == bounties[bountyId].teeExecutor, "not tee");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "reentrant");
        locked = true;
        _;
        locked = false;
    }

    function createBounty(
        string calldata title,
        string calldata rubric,
        uint64 submissionDeadline,
        uint64 judgingDeadline,
        address teeExecutor,
        bytes32 teePubkeyHash
    ) external payable returns (uint256 bountyId) {
        require(msg.value > 0, "reward required");
        require(submissionDeadline > block.timestamp, "submission deadline in past");
        require(judgingDeadline > submissionDeadline, "judging deadline too early");
        require(teeExecutor != address(0), "tee executor required");
        require(teePubkeyHash != bytes32(0), "tee pubkey hash required");

        bountyId = bounties.length;
        bounties.push(
            Bounty({
                owner: msg.sender,
                title: title,
                rubric: rubric,
                reward: msg.value,
                submissionDeadline: submissionDeadline,
                judgingDeadline: judgingDeadline,
                teeExecutor: teeExecutor,
                teePubkeyHash: teePubkeyHash,
                judged: false,
                finalized: false,
                refunded: false,
                judgmentHash: bytes32(0),
                judgmentRef: "",
                winnerIndex: NO_WINNER
            })
        );

        emit BountyCreated(
            bountyId,
            msg.sender,
            msg.value,
            submissionDeadline,
            judgingDeadline,
            teeExecutor,
            teePubkeyHash
        );
    }

    // bind the commitment to (bountyId, sender, payloadHash) so it can't be
    // copied across wallets or bounties
    function computeCommitment(
        uint256 bountyId,
        address participant,
        bytes32 payloadHash
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(bountyId, participant, payloadHash));
    }

    function submitEncrypted(
        uint256 bountyId,
        bytes32 payloadHash,
        string calldata payloadRef,
        bytes32 commitment
    ) external exists(bountyId) {
        Bounty storage b = bounties[bountyId];
        require(block.timestamp < b.submissionDeadline, "submission closed");
        require(payloadHash != bytes32(0), "empty payload hash");
        require(bytes(payloadRef).length > 0, "empty payload ref");
        require(!submitted[bountyId][msg.sender], "already submitted");
        require(
            computeCommitment(bountyId, msg.sender, payloadHash) == commitment,
            "bad commitment"
        );

        uint256 idx = subs[bountyId].length;
        subs[bountyId].push(
            Submission({
                participant: msg.sender,
                commitment: commitment,
                payloadHash: payloadHash,
                payloadRef: payloadRef,
                submittedAt: uint64(block.timestamp),
                invalidated: false
            })
        );
        submitted[bountyId][msg.sender] = true;

        emit SubmissionPosted(bountyId, msg.sender, idx, commitment, payloadHash, payloadRef);
    }

    // Called by the Ritual TEE after it has pulled, verified, decrypted, and
    // batch-judged every submission. The TEE flags malformed payloads via
    // invalidatedIndexes so the owner can't accidentally pay a broken one.
    function postBatchJudgment(
        uint256 bountyId,
        bytes32 judgmentHash,
        string calldata judgmentRef,
        uint256[] calldata invalidatedIndexes
    ) external exists(bountyId) onlyTEE(bountyId) {
        Bounty storage b = bounties[bountyId];
        require(block.timestamp >= b.submissionDeadline, "submission still open");
        require(block.timestamp < b.judgingDeadline, "judging window closed");
        require(!b.judged, "already judged");
        require(judgmentHash != bytes32(0), "empty judgment hash");
        require(bytes(judgmentRef).length > 0, "empty judgment ref");
        require(subs[bountyId].length > 0, "no submissions");

        Submission[] storage list = subs[bountyId];
        for (uint256 i = 0; i < invalidatedIndexes.length; i++) {
            uint256 idx = invalidatedIndexes[i];
            require(idx < list.length, "bad invalidated index");
            require(!list[idx].invalidated, "already invalidated");
            list[idx].invalidated = true;
            emit SubmissionInvalidatedByTEE(bountyId, idx);
        }

        b.judged = true;
        b.judgmentHash = judgmentHash;
        b.judgmentRef = judgmentRef;

        emit BatchJudged(bountyId, judgmentHash, judgmentRef, list.length);
    }

    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external exists(bountyId) onlyOwner(bountyId) nonReentrant {
        Bounty storage b = bounties[bountyId];
        require(b.judged, "not judged");
        require(!b.finalized, "already finalized");
        require(!b.refunded, "already refunded");
        require(winnerIndex < subs[bountyId].length, "bad winner index");

        Submission storage w = subs[bountyId][winnerIndex];
        require(!w.invalidated, "winner invalidated");

        uint256 amount = b.reward;
        b.reward = 0;
        b.finalized = true;
        b.winnerIndex = winnerIndex;

        (bool ok, ) = payable(w.participant).call{value: amount}("");
        require(ok, "payout failed");

        emit WinnerFinalized(bountyId, winnerIndex, w.participant, amount);
    }

    function refundIfNotJudged(
        uint256 bountyId
    ) external exists(bountyId) onlyOwner(bountyId) nonReentrant {
        Bounty storage b = bounties[bountyId];
        require(block.timestamp >= b.judgingDeadline, "judging still open");
        require(!b.judged, "already judged");
        require(!b.finalized, "already finalized");
        require(!b.refunded, "already refunded");

        uint256 amount = b.reward;
        b.reward = 0;
        b.refunded = true;

        (bool ok, ) = payable(b.owner).call{value: amount}("");
        require(ok, "refund failed");

        emit BountyRefunded(bountyId, b.owner, amount);
    }

    // ----- views -----

    function bountyCount() external view returns (uint256) {
        return bounties.length;
    }

    function getBounty(uint256 bountyId)
        external
        view
        exists(bountyId)
        returns (
            address owner,
            string memory title,
            string memory rubric,
            uint256 reward,
            uint64 submissionDeadline,
            uint64 judgingDeadline,
            address teeExecutor,
            bytes32 teePubkeyHash,
            bool judged,
            bool finalized,
            bool refunded,
            bytes32 judgmentHash,
            string memory judgmentRef,
            uint256 winnerIndex,
            uint256 submissionsCount
        )
    {
        Bounty storage b = bounties[bountyId];
        return (
            b.owner,
            b.title,
            b.rubric,
            b.reward,
            b.submissionDeadline,
            b.judgingDeadline,
            b.teeExecutor,
            b.teePubkeyHash,
            b.judged,
            b.finalized,
            b.refunded,
            b.judgmentHash,
            b.judgmentRef,
            b.winnerIndex,
            subs[bountyId].length
        );
    }

    function getSubmission(uint256 bountyId, uint256 index)
        external
        view
        exists(bountyId)
        returns (
            address participant,
            bytes32 commitment,
            bytes32 payloadHash,
            string memory payloadRef,
            uint64 submittedAt,
            bool invalidated
        )
    {
        require(index < subs[bountyId].length, "bad index");
        Submission storage s = subs[bountyId][index];
        return (s.participant, s.commitment, s.payloadHash, s.payloadRef, s.submittedAt, s.invalidated);
    }
}
