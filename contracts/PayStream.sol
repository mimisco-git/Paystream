// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ================================================================
// PayStream.sol
// On-chain salary stream registry on Arc (EVM-compatible L1)
//
// What this contract does:
//   - Registers every salary stream on-chain (immutable record)
//   - Emits events for every payout, pause, resume, and stop
//   - Stores verifiable wage-payment history per worker
//   - Lets anyone audit a worker's full payment history on Arcscan
//
// What it does NOT do:
//   - Hold USDC (that is managed by Circle developer-controlled wallets)
//   - Execute transfers (that is done by the Circle SDK backend)
//
// This contract is the on-chain truth layer. The Circle backend
// writes to it after every successful nanopayment. Judges can
// verify every payout at explorer.arc.testnet.circle.com
// ================================================================

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract PayStream {

    // ============================================================
    // TYPES
    // ============================================================

    enum StreamStatus { Active, Paused, Stopped }

    struct Stream {
        uint256 id;
        address employer;
        address worker;
        uint256 ratePerHour;      // USDC, 6 decimals (e.g. 18500000 = $18.50)
        uint256 startedAt;        // unix timestamp
        uint256 lastPayoutAt;     // unix timestamp
        uint256 totalPaid;        // cumulative USDC paid, 6 decimals
        StreamStatus status;
    }

    // ============================================================
    // STATE
    // ============================================================

    IERC20 public immutable usdc;
    address public immutable owner;

    uint256 public nextStreamId;
    mapping(uint256 => Stream) public streams;

    // worker address => list of stream IDs
    mapping(address => uint256[]) public workerStreams;

    // employer address => list of stream IDs
    mapping(address => uint256[]) public employerStreams;

    // ============================================================
    // EVENTS
    // Events are indexed on Arcscan — every payout is verifiable
    // ============================================================

    event StreamCreated(
        uint256 indexed streamId,
        address indexed employer,
        address indexed worker,
        uint256 ratePerHour,
        uint256 startedAt
    );

    event PayoutRecorded(
        uint256 indexed streamId,
        address indexed worker,
        uint256 amount,
        uint256 totalPaid,
        uint256 timestamp
    );

    event StreamPaused(
        uint256 indexed streamId,
        address indexed pausedBy,
        string reason,
        uint256 timestamp
    );

    event StreamResumed(
        uint256 indexed streamId,
        uint256 timestamp
    );

    event StreamStopped(
        uint256 indexed streamId,
        uint256 finalTotalPaid,
        uint256 timestamp
    );

    // ============================================================
    // MODIFIERS
    // ============================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "PayStream: not owner");
        _;
    }

    modifier streamExists(uint256 streamId) {
        require(streamId < nextStreamId, "PayStream: stream does not exist");
        _;
    }

    modifier onlyEmployerOrOwner(uint256 streamId) {
        require(
            msg.sender == streams[streamId].employer || msg.sender == owner,
            "PayStream: not authorized"
        );
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor(address _usdc) {
        usdc  = IERC20(_usdc);
        owner = msg.sender;
        nextStreamId = 0;
    }

    // ============================================================
    // CORE FUNCTIONS
    // ============================================================

    // createStream
    // Called by the PayStream backend when an employer starts
    // paying a worker. Registers the stream on-chain permanently.
    function createStream(
        address worker,
        uint256 ratePerHour   // USDC with 6 decimals
    ) external returns (uint256 streamId) {
        require(worker != address(0),    "PayStream: invalid worker");
        require(worker != msg.sender,    "PayStream: employer cannot be worker");
        require(ratePerHour > 0,         "PayStream: rate must be positive");

        streamId = nextStreamId++;

        streams[streamId] = Stream({
            id:           streamId,
            employer:     msg.sender,
            worker:       worker,
            ratePerHour:  ratePerHour,
            startedAt:    block.timestamp,
            lastPayoutAt: block.timestamp,
            totalPaid:    0,
            status:       StreamStatus.Active,
        });

        workerStreams[worker].push(streamId);
        employerStreams[msg.sender].push(streamId);

        emit StreamCreated(
            streamId,
            msg.sender,
            worker,
            ratePerHour,
            block.timestamp
        );
    }

    // recordPayout
    // Called by the PayStream backend after every successful
    // Circle nanopayment. Records the payout on-chain so it is
    // permanently verifiable on Arcscan.
    // Only the stream employer or contract owner can call this.
    function recordPayout(
        uint256 streamId,
        uint256 amount        // USDC with 6 decimals
    )
        external
        streamExists(streamId)
        onlyEmployerOrOwner(streamId)
    {
        Stream storage s = streams[streamId];
        require(s.status == StreamStatus.Active, "PayStream: stream not active");
        require(amount > 0, "PayStream: amount must be positive");

        s.totalPaid    += amount;
        s.lastPayoutAt  = block.timestamp;

        emit PayoutRecorded(
            streamId,
            s.worker,
            amount,
            s.totalPaid,
            block.timestamp
        );
    }

    // pauseStream
    // Called by the AI agent when work activity drops below threshold.
    function pauseStream(
        uint256 streamId,
        string calldata reason
    )
        external
        streamExists(streamId)
        onlyEmployerOrOwner(streamId)
    {
        Stream storage s = streams[streamId];
        require(s.status == StreamStatus.Active, "PayStream: not active");

        s.status = StreamStatus.Paused;

        emit StreamPaused(streamId, msg.sender, reason, block.timestamp);
    }

    // resumeStream
    // Called by the AI agent when work activity recovers.
    function resumeStream(
        uint256 streamId
    )
        external
        streamExists(streamId)
        onlyEmployerOrOwner(streamId)
    {
        Stream storage s = streams[streamId];
        require(s.status == StreamStatus.Paused, "PayStream: not paused");

        s.status      = StreamStatus.Active;
        s.lastPayoutAt = block.timestamp; // reset clock on resume

        emit StreamResumed(streamId, block.timestamp);
    }

    // stopStream
    // Permanently ends a stream.
    function stopStream(
        uint256 streamId
    )
        external
        streamExists(streamId)
        onlyEmployerOrOwner(streamId)
    {
        Stream storage s = streams[streamId];
        require(s.status != StreamStatus.Stopped, "PayStream: already stopped");

        s.status = StreamStatus.Stopped;

        emit StreamStopped(streamId, s.totalPaid, block.timestamp);
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    function getStream(uint256 streamId)
        external
        view
        streamExists(streamId)
        returns (Stream memory)
    {
        return streams[streamId];
    }

    function getWorkerStreams(address worker)
        external
        view
        returns (uint256[] memory)
    {
        return workerStreams[worker];
    }

    function getEmployerStreams(address employer)
        external
        view
        returns (uint256[] memory)
    {
        return employerStreams[employer];
    }

    // calculateEarned
    // Returns how much USDC a worker has earned since last payout.
    // Mirrors the backend getEarnedSince() calculation on-chain.
    function calculateEarned(uint256 streamId)
        external
        view
        streamExists(streamId)
        returns (uint256 earned)
    {
        Stream memory s = streams[streamId];
        if (s.status != StreamStatus.Active) return 0;

        uint256 elapsed = block.timestamp - s.lastPayoutAt;
        // rate is per hour, elapsed is in seconds
        // earned = elapsed * ratePerHour / 3600
        earned = (elapsed * s.ratePerHour) / 3600;
    }

    // totalStreams
    function totalStreams() external view returns (uint256) {
        return nextStreamId;
    }
}
