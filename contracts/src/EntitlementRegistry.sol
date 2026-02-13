// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

contract EntitlementRegistry is ReceiverTemplate {
    enum ProductStatus {
        ACTIVE,
        PAUSED,
        DISCONTINUED,
        BANNED
    }

    enum ReportAction {
        RECORD_ENTITLEMENT,
        SET_STATUS
    }

    mapping(address buyer => mapping(string productId => bool entitled)) private _entitlements;
    mapping(string productId => ProductStatus status) private _productStatus;

    event EntitlementRecorded(address indexed buyer, string indexed productId, address indexed actor);
    event ProductStatusUpdated(
        string indexed productId,
        ProductStatus previousStatus,
        ProductStatus newStatus,
        address indexed actor
    );

    error InvalidStatus(uint8 statusCode);
    error UnsupportedAction(uint8 action);

    modifier onlyOwnerOrSelf() {
        if (msg.sender != owner && msg.sender != address(this)) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    constructor(address initialOwner, address initialForwarder) ReceiverTemplate(initialForwarder) {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (initialOwner != owner) {
            address previousOwner = owner;
            owner = initialOwner;
            emit OwnershipTransferred(previousOwner, initialOwner);
        }
    }

    function recordEntitlement(address buyer, string calldata productId) external onlyOwnerOrSelf {
        _entitlements[buyer][productId] = true;
        emit EntitlementRecorded(buyer, productId, msg.sender);
    }

    function hasEntitlement(address buyer, string calldata productId) external view returns (bool) {
        return _entitlements[buyer][productId];
    }

    function setStatus(string calldata productId, ProductStatus newStatus) external onlyOwnerOrSelf {
        ProductStatus previousStatus = _productStatus[productId];
        _productStatus[productId] = newStatus;
        emit ProductStatusUpdated(productId, previousStatus, newStatus, msg.sender);
    }

    function getStatus(string calldata productId) external view returns (ProductStatus) {
        return _productStatus[productId];
    }

    function _processReport(bytes calldata, bytes calldata report) internal override {
        (uint8 action, address buyer, string memory productId, uint8 statusCode) =
            abi.decode(report, (uint8, address, string, uint8));

        if (action == uint8(ReportAction.RECORD_ENTITLEMENT)) {
            _entitlements[buyer][productId] = true;
            emit EntitlementRecorded(buyer, productId, address(this));
            return;
        }

        if (action == uint8(ReportAction.SET_STATUS)) {
            if (statusCode > uint8(ProductStatus.BANNED)) revert InvalidStatus(statusCode);
            ProductStatus previousStatus = _productStatus[productId];
            ProductStatus newStatus = ProductStatus(statusCode);
            _productStatus[productId] = newStatus;
            emit ProductStatusUpdated(productId, previousStatus, newStatus, address(this));
            return;
        }

        revert UnsupportedAction(action);
    }
}
