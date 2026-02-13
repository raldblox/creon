// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/EntitlementRegistry.sol";

contract DeployEntitlementRegistry is Script {
    function run() external returns (EntitlementRegistry registry) {
        uint256 deployerPrivateKey = uint256(vm.envBytes32("CRE_ETH_PRIVATE_KEY"));
        address owner = vm.addr(deployerPrivateKey);
        address forwarder = vm.envAddress("CRE_FORWARDER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        registry = new EntitlementRegistry(owner, forwarder);
        vm.stopBroadcast();

        console2.log("Network chainid:", block.chainid);
        console2.log("Entitlement owner:", owner);
        console2.log("EntitlementRegistry deployed:", address(registry));
    }
}
