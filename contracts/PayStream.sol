// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PayStream
 * @notice On-chain stream registry for real-time USDC salary streaming on Arc.
 *         Records every stream created, paused, resumed, and stopped.
 *         All actual USDC transfers happen via Circle developer-controlled wallets.
 *         This contract is the verifiable on-chain record of employment agreements.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract PayStream {

    // ── USDC contract on Arc testnet ──
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    // ── Stream status ──
    enum StreamStatus { Active, Paused, Stopped }

    // ── Stream struct ──
    struct Stream {
        uint256 id;
        address employer;
        address worker;
        uint256 ratePerSecond;   // USDC per second in 6-decimal units
        uint256 startedAt;
        uint256 lastPayoutAt;
        uint256 totalPaid;
        StreamStatus status;
    }

    // ── State ──
    uint256 public nextStreamId = 1;
    mapping(uint256 => Stream) public streams;
    mapping(address => uint256[]) public employerStreams;
    mapping(address => uint256[]) public workerStreams;

    // ── Events ──
    event StreamCreated(uint256 indexed id, address indexed employer, address indexed worker, uint256 ratePerSecond);
    event StreamPaused(uint256 indexed id, address indexed by);
    event StreamResumed(uint256 indexed id, address indexed by);
    event StreamStopped(uint256 indexed id, address indexed by);
    event PaymentDispatched(uint256 indexed id, address indexed worker, uint256 amount);

    // ── Modifiers ──
    modifier onlyEmployer(uint256 streamId) {
        require(streams[streamId].employer == msg.sender, "PayStream: caller is not the employer");
        _;
    }

    modifier streamExists(uint256 streamId) {
        require(streams[streamId].startedAt > 0, "PayStream: stream does not exist");
        _;
    }

    // ── Create stream ──
    function createStream(address worker, uint256 ratePerHour) external returns (uint256) {
        require(worker != address(0), "PayStream: invalid worker address");
        require(worker != msg.sender, "PayStream: employer cannot stream to self");
        require(ratePerHour > 0, "PayStream: rate must be positive");

        // Convert hourly rate to per-second (USDC has 6 decimals)
        uint256 ratePerSecond = (ratePerHour * 1e6) / 3600;

        uint256 id = nextStreamId++;
        streams[id] = Stream({
            id:            id,
            employer:      msg.sender,
            worker:        worker,
            ratePerSecond: ratePerSecond,
            startedAt:     block.timestamp,
            lastPayoutAt:  block.timestamp,
            totalPaid:     0,
            status:        StreamStatus.Active
        });

        employerStreams[msg.sender].push(id);
        workerStreams[worker].push(id);

        emit StreamCreated(id, msg.sender, worker, ratePerSecond);
        return id;
    }

    // ── Pause stream (employer only) ──
    function pauseStream(uint256 streamId)
        external
        streamExists(streamId)
        onlyEmployer(streamId)
    {
        require(streams[streamId].status == StreamStatus.Active, "PayStream: stream not active");
        streams[streamId].status = StreamStatus.Paused;
        emit StreamPaused(streamId, msg.sender);
    }

    // ── Resume stream (employer only) ──
    function resumeStream(uint256 streamId)
        external
        streamExists(streamId)
        onlyEmployer(streamId)
    {
        require(streams[streamId].status == StreamStatus.Paused, "PayStream: stream not paused");
        streams[streamId].status        = StreamStatus.Active;
        streams[streamId].lastPayoutAt  = block.timestamp;
        emit StreamResumed(streamId, msg.sender);
    }

    // ── Stop stream (employer only) ──
    function stopStream(uint256 streamId)
        external
        streamExists(streamId)
        onlyEmployer(streamId)
    {
        require(streams[streamId].status != StreamStatus.Stopped, "PayStream: already stopped");
        streams[streamId].status = StreamStatus.Stopped;
        emit StreamStopped(streamId, msg.sender);
    }

    // ── Calculate earned amount ──
    function earned(uint256 streamId) public view streamExists(streamId) returns (uint256) {
        Stream memory s = streams[streamId];
        if (s.status != StreamStatus.Active) return 0;
        uint256 elapsed = block.timestamp - s.lastPayoutAt;
        return elapsed * s.ratePerSecond;
    }

    // ── Dispatch payment (called by PayStream backend cron) ──
    function dispatchPayment(uint256 streamId) external streamExists(streamId) {
        Stream storage s = streams[streamId];
        require(s.status == StreamStatus.Active, "PayStream: stream not active");
        uint256 amount = earned(streamId);
        require(amount > 0, "PayStream: nothing to pay");
        s.lastPayoutAt  = block.timestamp;
        s.totalPaid    += amount;
        require(IERC20(USDC).transferFrom(s.employer, s.worker, amount), "PayStream: USDC transfer failed");
        emit PaymentDispatched(streamId, s.worker, amount);
    }

    // ── View helpers ──
    function getStream(uint256 streamId) external view returns (Stream memory) {
        return streams[streamId];
    }

    function getEmployerStreams(address employer) external view returns (uint256[] memory) {
        return employerStreams[employer];
    }

    function getWorkerStreams(address worker) external view returns (uint256[] memory) {
        return workerStreams[worker];
    }
}
