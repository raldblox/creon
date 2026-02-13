// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract CommerceCheckout {
    uint16 public constant MAX_FEE_BPS = 2500; // 25%

    address public owner;
    address public feeRecipient;
    uint16 public feeBps;
    IERC20Minimal public immutable paymentToken;

    uint256 public totalPurchases;
    uint256 public totalGrossVolume;
    uint256 public totalFeeCollected;
    uint256 public totalMerchantPayout;

    mapping(address wallet => uint256 amount) public totalEarningsByWallet;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event FeeBpsUpdated(uint16 previousFeeBps, uint16 newFeeBps);
    event PurchaseSettled(
        address indexed buyer,
        address indexed merchant,
        string indexed productId,
        uint256 baseAmount,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 merchantNetAmount
    );

    error Unauthorized(address caller);
    error ZeroAddress();
    error InvalidFeeBps(uint16 feeBps);
    error InvalidAmount();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    constructor(address tokenAddress, address initialFeeRecipient, uint16 initialFeeBps) {
        if (tokenAddress == address(0) || initialFeeRecipient == address(0)) revert ZeroAddress();
        if (initialFeeBps > MAX_FEE_BPS) revert InvalidFeeBps(initialFeeBps);

        owner = msg.sender;
        paymentToken = IERC20Minimal(tokenAddress);
        feeRecipient = initialFeeRecipient;
        feeBps = initialFeeBps;

        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientUpdated(address(0), initialFeeRecipient);
        emit FeeBpsUpdated(0, initialFeeBps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        address previousRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(previousRecipient, newRecipient);
    }

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert InvalidFeeBps(newFeeBps);
        uint16 previousFeeBps = feeBps;
        feeBps = newFeeBps;
        emit FeeBpsUpdated(previousFeeBps, newFeeBps);
    }

    function quoteSplit(uint256 baseAmount)
        public
        view
        returns (uint256 grossAmount, uint256 feeAmount, uint256 merchantNetAmount)
    {
        if (baseAmount == 0) revert InvalidAmount();
        feeAmount = (baseAmount * feeBps) / 10_000;
        grossAmount = baseAmount + feeAmount;
        merchantNetAmount = baseAmount;
    }

    function purchase(string calldata productId, address merchant, uint256 baseAmount)
        external
        returns (uint256 grossAmount, uint256 feeAmount, uint256 merchantNetAmount)
    {
        if (merchant == address(0)) revert ZeroAddress();
        (grossAmount, feeAmount, merchantNetAmount) = quoteSplit(baseAmount);

        bool pulled = paymentToken.transferFrom(msg.sender, address(this), grossAmount);
        if (!pulled) revert TransferFailed();

        bool paidFee = paymentToken.transfer(feeRecipient, feeAmount);
        if (!paidFee) revert TransferFailed();

        bool paidMerchant = paymentToken.transfer(merchant, merchantNetAmount);
        if (!paidMerchant) revert TransferFailed();

        totalPurchases += 1;
        totalGrossVolume += grossAmount;
        totalFeeCollected += feeAmount;
        totalMerchantPayout += merchantNetAmount;

        totalEarningsByWallet[feeRecipient] += feeAmount;
        totalEarningsByWallet[merchant] += merchantNetAmount;

        emit PurchaseSettled(
            msg.sender,
            merchant,
            productId,
            baseAmount,
            grossAmount,
            feeAmount,
            merchantNetAmount
        );
    }
}
