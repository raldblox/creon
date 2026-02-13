// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReceiver} from "./IReceiver.sol";
import {IERC165} from "./IERC165.sol";

abstract contract ReceiverTemplate is IReceiver {
    error InvalidSender(address received, address expected);
    error InvalidAuthor(address received, address expected);
    error InvalidWorkflowName(bytes10 received, bytes10 expected);
    error InvalidWorkflowId(bytes32 received, bytes32 expected);
    error Unauthorized(address caller);
    error ZeroAddress();

    // Metadata layout used by CRE reports:
    // bytes 32..63  => workflow execution id (bytes32)
    // bytes 64..73  => workflow name (bytes10)
    // bytes 74..93  => workflow owner/author (address)
    uint256 private constant WORKFLOW_ID_OFFSET = 32;
    uint256 private constant WORKFLOW_NAME_OFFSET = 64;
    uint256 private constant WORKFLOW_OWNER_OFFSET = 74;

    address public owner;
    address public forwarderAddress;
    address public expectedAuthor;
    bytes10 public expectedWorkflowName;
    bytes32 public expectedWorkflowId;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ForwarderUpdated(address indexed previousForwarder, address indexed newForwarder);
    event ExpectedAuthorUpdated(address indexed previousAuthor, address indexed newAuthor);
    event ExpectedWorkflowNameUpdated(bytes10 previousName, bytes10 newName);
    event ExpectedWorkflowIdUpdated(bytes32 previousId, bytes32 newId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    constructor(address initialForwarder) {
        if (initialForwarder == address(0)) revert ZeroAddress();
        owner = msg.sender;
        forwarderAddress = initialForwarder;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ForwarderUpdated(address(0), initialForwarder);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setForwarderAddress(address newForwarder) external onlyOwner {
        if (newForwarder == address(0)) revert ZeroAddress();
        address previousForwarder = forwarderAddress;
        forwarderAddress = newForwarder;
        emit ForwarderUpdated(previousForwarder, newForwarder);
    }

    function setExpectedAuthor(address newExpectedAuthor) external onlyOwner {
        address previousAuthor = expectedAuthor;
        expectedAuthor = newExpectedAuthor;
        emit ExpectedAuthorUpdated(previousAuthor, newExpectedAuthor);
    }

    function setExpectedWorkflowName(bytes10 newExpectedWorkflowName) external onlyOwner {
        bytes10 previousWorkflowName = expectedWorkflowName;
        expectedWorkflowName = newExpectedWorkflowName;
        emit ExpectedWorkflowNameUpdated(previousWorkflowName, newExpectedWorkflowName);
    }

    function setExpectedWorkflowId(bytes32 newExpectedWorkflowId) external onlyOwner {
        bytes32 previousWorkflowId = expectedWorkflowId;
        expectedWorkflowId = newExpectedWorkflowId;
        emit ExpectedWorkflowIdUpdated(previousWorkflowId, newExpectedWorkflowId);
    }

    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarderAddress) {
            revert InvalidSender(msg.sender, forwarderAddress);
        }

        (bytes32 workflowId, bytes10 workflowName, address workflowAuthor) =
            _extractMetadata(metadata);

        if (expectedAuthor != address(0) && workflowAuthor != expectedAuthor) {
            revert InvalidAuthor(workflowAuthor, expectedAuthor);
        }
        if (expectedWorkflowName != bytes10(0) && workflowName != expectedWorkflowName) {
            revert InvalidWorkflowName(workflowName, expectedWorkflowName);
        }
        if (expectedWorkflowId != bytes32(0) && workflowId != expectedWorkflowId) {
            revert InvalidWorkflowId(workflowId, expectedWorkflowId);
        }

        _processReport(metadata, report);
    }

    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _extractMetadata(bytes calldata metadata)
        internal
        pure
        returns (bytes32 workflowId, bytes10 workflowName, address workflowAuthor)
    {
        if (metadata.length >= WORKFLOW_ID_OFFSET + 32) {
            workflowId = bytes32(metadata[WORKFLOW_ID_OFFSET:WORKFLOW_ID_OFFSET + 32]);
        }
        if (metadata.length >= WORKFLOW_NAME_OFFSET + 10) {
            workflowName = bytes10(metadata[WORKFLOW_NAME_OFFSET:WORKFLOW_NAME_OFFSET + 10]);
        }
        if (metadata.length >= WORKFLOW_OWNER_OFFSET + 20) {
            workflowAuthor = address(bytes20(metadata[WORKFLOW_OWNER_OFFSET:WORKFLOW_OWNER_OFFSET + 20]));
        }
    }

    function _processReport(bytes calldata metadata, bytes calldata report) internal virtual;
}
