// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Privacy Preserving AI Bounty Judge
/// @notice Commit-reveal version of the Ritual AI Bounty Judge workshop flow.
contract PrivacyPreservingBountyJudge {
    struct Bounty {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint64 submissionDeadline;
        uint64 revealDeadline;
        bool judged;
        bool finalized;
        bool refunded;
        bytes llmInput;
        uint256 winnerIndex;
    }

    struct Commitment {
        bytes32 commitment;
        bool exists;
        bool revealed;
    }

    struct RevealedSubmission {
        address participant;
        string answer;
        bytes32 commitment;
    }

    uint256 private constant NO_WINNER = type(uint256).max;

    Bounty[] private bounties;
    mapping(uint256 bountyId => mapping(address participant => Commitment)) private commitments;
    mapping(uint256 bountyId => RevealedSubmission[]) private revealedSubmissions;

    bool private locked;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        uint256 reward,
        uint64 submissionDeadline,
        uint64 revealDeadline
    );
    event CommitmentSubmitted(uint256 indexed bountyId, address indexed participant, bytes32 commitment);
    event AnswerRevealed(uint256 indexed bountyId, address indexed participant, uint256 indexed revealedIndex);
    event BountyJudged(uint256 indexed bountyId, uint256 revealedCount, bytes32 aiReviewHash);
    event WinnerFinalized(uint256 indexed bountyId, uint256 indexed winnerIndex, address indexed winner, uint256 amount);
    event BountyRefunded(uint256 indexed bountyId, address indexed owner, uint256 amount);

    modifier bountyExists(uint256 bountyId) {
        require(bountyId < bounties.length, "Bounty does not exist");
        _;
    }

    modifier onlyBountyOwner(uint256 bountyId) {
        require(msg.sender == bounties[bountyId].owner, "Only bounty owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    function createBounty(
        string calldata title,
        string calldata rubric,
        uint64 submissionDeadline,
        uint64 revealDeadline
    ) external payable returns (uint256 bountyId) {
        require(msg.value > 0, "Reward required");
        require(submissionDeadline > block.timestamp, "Submission deadline must be future");
        require(revealDeadline > submissionDeadline, "Reveal deadline must be later");

        bountyId = bounties.length;
        bounties.push(
            Bounty({
                owner: msg.sender,
                title: title,
                rubric: rubric,
                reward: msg.value,
                submissionDeadline: submissionDeadline,
                revealDeadline: revealDeadline,
                judged: false,
                finalized: false,
                refunded: false,
                llmInput: "",
                winnerIndex: NO_WINNER
            })
        );

        emit BountyCreated(bountyId, msg.sender, msg.value, submissionDeadline, revealDeadline);
    }

    /// @notice Compute the commitment participants should submit before the reveal phase.
    /// @dev Formula from the homework: keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId)).
    ///      Binding to msg.sender + bountyId stops cross-wallet and cross-bounty replay.
    function computeCommitment(
        uint256 bountyId,
        address participant,
        string memory answer,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(answer, salt, participant, bountyId));
    }

    function submitCommitment(uint256 bountyId, bytes32 commitment) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];
        require(block.timestamp < bounty.submissionDeadline, "Submission phase closed");
        require(commitment != bytes32(0), "Empty commitment");

        Commitment storage saved = commitments[bountyId][msg.sender];
        require(!saved.exists, "Already committed");

        saved.commitment = commitment;
        saved.exists = true;

        emit CommitmentSubmitted(bountyId, msg.sender, commitment);
    }

    function revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];
        require(block.timestamp >= bounty.submissionDeadline, "Reveal phase not started");
        require(block.timestamp < bounty.revealDeadline, "Reveal phase closed");

        Commitment storage saved = commitments[bountyId][msg.sender];
        require(saved.exists, "No commitment");
        require(!saved.revealed, "Already revealed");

        bytes32 expected = computeCommitment(bountyId, msg.sender, answer, salt);
        require(expected == saved.commitment, "Invalid reveal");

        saved.revealed = true;
        uint256 revealedIndex = revealedSubmissions[bountyId].length;
        RevealedSubmission storage revealed = revealedSubmissions[bountyId].push();
        revealed.participant = msg.sender;
        revealed.answer = answer;
        revealed.commitment = saved.commitment;

        emit AnswerRevealed(bountyId, msg.sender, revealedIndex);
    }

    /// @notice Stores one batch AI review covering every valid revealed answer for the bounty.
    /// @dev The review should come from a single Ritual AI batch request, not one request per answer.
    ///      llmInput is bytes so callers can pass the raw LLM payload (UTF-8 text or JSON bytes).
    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyBountyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];
        require(block.timestamp >= bounty.revealDeadline, "Reveal phase still open");
        require(!bounty.judged, "Already judged");
        require(revealedSubmissions[bountyId].length > 0, "No valid reveals");
        require(llmInput.length > 0, "Empty AI review");

        bounty.judged = true;
        bounty.llmInput = llmInput;

        emit BountyJudged(bountyId, revealedSubmissions[bountyId].length, keccak256(llmInput));
    }

    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyBountyOwner(bountyId) nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        require(bounty.judged, "Not judged");
        require(!bounty.finalized, "Already finalized");
        require(!bounty.refunded, "Already refunded");
        require(winnerIndex < revealedSubmissions[bountyId].length, "Invalid winner index");

        RevealedSubmission storage winningSubmission = revealedSubmissions[bountyId][winnerIndex];
        uint256 amount = bounty.reward;
        bounty.reward = 0;
        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        (bool ok, ) = payable(winningSubmission.participant).call{value: amount}("");
        require(ok, "Payout failed");

        emit WinnerFinalized(bountyId, winnerIndex, winningSubmission.participant, amount);
    }

    /// @notice Optional recovery path when no participant reveals a valid answer.
    function refundIfNoValidReveals(uint256 bountyId) external bountyExists(bountyId) onlyBountyOwner(bountyId) nonReentrant {
        Bounty storage bounty = bounties[bountyId];
        require(block.timestamp >= bounty.revealDeadline, "Reveal phase still open");
        require(!bounty.judged, "Already judged");
        require(!bounty.finalized, "Already finalized");
        require(!bounty.refunded, "Already refunded");
        require(revealedSubmissions[bountyId].length == 0, "Valid reveals exist");

        uint256 amount = bounty.reward;
        bounty.reward = 0;
        bounty.refunded = true;

        (bool ok, ) = payable(bounty.owner).call{value: amount}("");
        require(ok, "Refund failed");

        emit BountyRefunded(bountyId, bounty.owner, amount);
    }

    function bountyCount() external view returns (uint256) {
        return bounties.length;
    }

    function getBounty(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address owner,
            string memory title,
            string memory rubric,
            uint256 reward,
            uint64 submissionDeadline,
            uint64 revealDeadline,
            bool judged,
            bool finalized,
            bool refunded,
            bytes memory llmInput,
            uint256 winnerIndex,
            uint256 revealedCount
        )
    {
        Bounty storage bounty = bounties[bountyId];
        return (
            bounty.owner,
            bounty.title,
            bounty.rubric,
            bounty.reward,
            bounty.submissionDeadline,
            bounty.revealDeadline,
            bounty.judged,
            bounty.finalized,
            bounty.refunded,
            bounty.llmInput,
            bounty.winnerIndex,
            revealedSubmissions[bountyId].length
        );
    }

    function getCommitment(
        uint256 bountyId,
        address participant
    ) external view bountyExists(bountyId) returns (bytes32 commitment, bool exists, bool revealed) {
        Commitment storage saved = commitments[bountyId][participant];
        return (saved.commitment, saved.exists, saved.revealed);
    }

    function getRevealedSubmission(
        uint256 bountyId,
        uint256 revealedIndex
    )
        external
        view
        bountyExists(bountyId)
        returns (address participant, string memory answer, bytes32 commitment)
    {
        require(revealedIndex < revealedSubmissions[bountyId].length, "Invalid revealed index");
        RevealedSubmission storage submission = revealedSubmissions[bountyId][revealedIndex];
        return (submission.participant, submission.answer, submission.commitment);
    }
}
