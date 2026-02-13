// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/CommerceCheckout.sol";

contract DeployCommerceCheckout is Script {
    address internal constant DEFAULT_FEE_RECIPIENT = 0x001047dd630b4d985Dd0d13dFeac95C1536966F8;

    function run() external returns (CommerceCheckout checkout) {
        uint256 deployerPrivateKey = uint256(vm.envBytes32("CRE_ETH_PRIVATE_KEY"));
        address token = vm.envAddress("COMMERCE_USDC_ADDRESS");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", DEFAULT_FEE_RECIPIENT);
        uint16 initialFeeBps = uint16(vm.envUint("COMMERCE_FEE_BPS"));

        vm.startBroadcast(deployerPrivateKey);
        checkout = new CommerceCheckout(token, feeRecipient, initialFeeBps);
        vm.stopBroadcast();

        console2.log("Network chainid:", block.chainid);
        console2.log("CommerceCheckout deployed:", address(checkout));
        console2.log("Payment token:", token);
        console2.log("Fee recipient:", feeRecipient);
        console2.log("Initial fee bps:", initialFeeBps);
    }
}
