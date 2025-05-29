// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {IAirdropRewarder} from "../interfaces/IAirdropRewarder.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title AirdropRewarder
 * @notice Distributes ERC20 tokens to users based on a Merkle root proof.
 *         Supports both regular and premium tokens with different reward values.
 *         Each token can have its Merkle root set only once by the launchpad.
 *         Uses index-based claim tracking to support multiple claims per address.
 */
contract AirdropRewarder is IAirdropRewarder, Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
  using SafeERC20 for IERC20;

  mapping(address => bytes32) public tokenMerkleRoots;
  mapping(address => mapping(address => bool)) public rewardsClaimed;
  address public launchpad;
  mapping(address => uint256) public airdropAmount;

  /// @inheritdoc IAirdropRewarder
  function initialize(address _launchpad) external initializer {
    __Ownable_init(msg.sender);
    __ReentrancyGuard_init();

    if (_launchpad == address(0)) revert InvalidAddress();

    launchpad = _launchpad;
  }

  modifier onlyLaunchpad() {
    if (msg.sender != launchpad) revert OnlyLaunchpadCanSetMerkleRoot();
    _;
  }

  /// @inheritdoc IAirdropRewarder
  function setLaunchpad(address _launchpad) external onlyOwner {
    if (_launchpad == address(0)) revert InvalidAddress();
    launchpad = _launchpad;
  }

  /// @inheritdoc IAirdropRewarder
  function setAirdropAmount(address _token, uint256 _amount) external onlyLaunchpad {
    if (_token == address(0)) revert InvalidAddress();
    airdropAmount[_token] = _amount;
  }

  /// @inheritdoc IAirdropRewarder
  function setMerkleRoot(address _token, bytes32 _merkleRoot) external onlyLaunchpad {
    if (_token == address(0)) revert InvalidAddress();
    if (_merkleRoot == bytes32(0)) revert InvalidRoot();
    if (tokenMerkleRoots[_token] != bytes32(0)) revert MerkleRootAlreadySet();

    tokenMerkleRoots[_token] = _merkleRoot;

    emit MerkleRootSet(_token, _merkleRoot);
  }

  /// @inheritdoc IAirdropRewarder
  function claim(address _token, address _user, uint256 _claimAmount, bytes32[] calldata _merkleProofs)
    external
    nonReentrant
  {
    if (rewardsClaimed[_token][_user]) revert AlreadyClaimed();
    if (tokenMerkleRoots[_token] == bytes32(0)) revert MerkleRootNotSet();

    bytes32 node = keccak256(abi.encodePacked(_user, _claimAmount));

    if (!MerkleProof.verify(_merkleProofs, tokenMerkleRoots[_token], node)) revert InvalidMerkleProof(_merkleProofs);
    rewardsClaimed[_token][_user] = true;

     // Multiply by ration and scale down to 18 decimals
    IERC20(_token).safeTransfer(_user, _claimAmount * airdropAmount[_token] / 1e18);
    emit RewardsClaimed(_token, _user, _claimAmount);
  }

  /// @inheritdoc IAirdropRewarder
  function emergencyWithdrawal(address token, address to) external onlyOwner {
    if (to == address(0) || token == address(0)) revert InvalidAddress();
    IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
  }
}
