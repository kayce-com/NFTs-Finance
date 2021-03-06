// contracts/Market.sol
// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/utils/Counters.sol";
import "@openzeppelin/security/ReentrancyGuard.sol";
import "@openzeppelin/token/ERC721/IERC721.sol";
import "@openzeppelin/access/Ownable.sol";

import "hardhat/console.sol";


contract NFTMarket is ReentrancyGuard, Ownable {
    using Counters for Counters.Counter;
    Counters.Counter private _itemIds;
    Counters.Counter private _itemsSold;

    uint256 listingPrice;

    // 1 -- false, Fixed
    // 2 -- true, Auction

    struct MarketItem {
        address nftContract;
        address originalCreator;
        address payable seller;
        address payable owner;
        address payable currentBidder;
        uint256 itemId;
        uint256 price;
        uint256 sellPrice;
        uint256 sold;
        uint256 tokenId;
        uint256 currentBid;
        uint256 marketType;
    }

    mapping(uint256 => MarketItem) public idToMarketItem;
    mapping(uint256 => mapping(address => uint256)) public fundsByBidder;
    mapping(uint256 => uint256) public auctionItemNumberOfBidders;
    mapping(uint256 => address[]) public auctionItemBidders;

    event MarketItemCreated(
        uint256 indexed itemId,
        address indexed nftContract,
        uint256 indexed tokenId,
        address seller,
        address owner,
        uint256 price,
        uint256 sold
    );

    event Bid(address bidder, uint256 bid, uint256 itemId);

    /* Returns the listing price of the contract */
    function getListingPrice() public view returns (uint256) {
        return listingPrice;
    }

    /* Set the listing price of the contract */
    function setListingPrice(uint256 price) external onlyOwner {
        listingPrice = price;
    }

    /* Places an item for sale on the marketplace */
    /* marketType can either be Auction or Fixed */
    function createMarketItem(
        address nftContract,
        uint256 tokenId,
        uint256 price,
        uint256 marketType
    ) public payable nonReentrant {
        require(price > 0, "Price must be greater than 0");
        require(
            msg.value == listingPrice,
            "Value must be equal to listing price"
        );
        require(
            marketType == 1 || marketType == 2,
            "Market type must be either Auction or Fixed"
        );

        IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);
        (bool success, ) = payable(owner()).call{value: listingPrice}("");
        require(success, "Failed to transfer lisiting price to market owner");

        _itemIds.increment();
        uint256 itemId = _itemIds.current();

        idToMarketItem[itemId] = MarketItem(
            nftContract,
            msg.sender,
            payable(msg.sender),
            payable(address(this)),
            payable(msg.sender),
            itemId,
            price,
            0,
            1,
            tokenId,
            0,
            marketType
        );

        emit MarketItemCreated(
            itemId,
            nftContract,
            tokenId,
            msg.sender,
            address(this),
            price,
            1
        );
    }

    /* Bid for a market item on auction */
    function bidForMarketItem(uint256 itemId) public payable nonReentrant {
        require(msg.value > 0, "Bid must be greater than 0");
        require(
            idToMarketItem[itemId].marketType == 2,
            "Only auctions can be bidded on"
        );
        require(idToMarketItem[itemId].sold == 1, "Item has already been sold");
        require(
            msg.sender != idToMarketItem[itemId].seller,
            "You cannot bid on your own item"
        );
        uint256 bidderOld = fundsByBidder[itemId][msg.sender];
        uint256 minBid = (
            idToMarketItem[itemId].currentBid == 0
                ? idToMarketItem[itemId].price
                : idToMarketItem[itemId].currentBid
        );
        if (bidderOld == 0) {
            require(
                msg.value > minBid,
                "Your bid must be greater than the current bid"
            );
            auctionItemNumberOfBidders[itemId]++;
            auctionItemBidders[itemId].push(msg.sender);
        } else {
            require(
                bidderOld + msg.value > minBid,
                "Your bid must be greater than the current bid"
            );
        }
        fundsByBidder[itemId][msg.sender] = msg.value + bidderOld;
        idToMarketItem[itemId].currentBidder = payable(msg.sender);
        idToMarketItem[itemId].currentBid = msg.value + bidderOld;
        emit Bid(msg.sender, msg.value + bidderOld, itemId);
    }

    /* End Auction */
    /* Transfers ownership of the item, as well as funds between parties */
    /* Returns bids back to the bidders */
    function endAuction(uint256 itemId) public nonReentrant {
        MarketItem memory item = idToMarketItem[itemId];

        require(
            msg.sender == item.seller,
            "Ownable: Only auction owner can end auction"
        );

        uint256 currentBid = idToMarketItem[itemId].currentBid;
        uint256 tokenId = idToMarketItem[itemId].tokenId;

        (bool success, ) = idToMarketItem[itemId].seller.call{
            value: currentBid
        }("");
        require(success, "Transfer of funds to seller failed.");

        IERC721(idToMarketItem[itemId].nftContract).transferFrom(
            address(this),
            idToMarketItem[itemId].currentBidder,
            tokenId
        );

        uint256 numberOfBidders = auctionItemNumberOfBidders[itemId];

        for (uint256 i = 0; i < numberOfBidders; i++) {
            address bidderToRefund = auctionItemBidders[itemId][i];

            if (bidderToRefund == idToMarketItem[itemId].currentBidder) {
                continue;
            }

            uint256 bidToBeRefunded = fundsByBidder[itemId][bidderToRefund];
            (bool successful, ) = payable(bidderToRefund).call{
                value: bidToBeRefunded
            }("");
            require(successful, "Refund failed");

            // delete fundsByBidder[itemId][bidderToRefund];
            // delete auctionItemBidders[itemId][i];
        }
        idToMarketItem[itemId].owner = payable(
            idToMarketItem[itemId].currentBidder
        );
        idToMarketItem[itemId].seller = payable(
            idToMarketItem[itemId].currentBidder
        );
        idToMarketItem[itemId].sold = 2;

        idToMarketItem[itemId].currentBid = 0;

        idToMarketItem[itemId].sellPrice = currentBid;
    }

    /* Places a previously sold item for sale on the marketplace */
    /* marketType can either be Auction or Fixed */
    /*The owner of the NFT must first approve this contract before calling this function */
    function resellMarketItem(
        uint256 itemId,
        uint256 price,
        uint256 marketType
    ) public payable nonReentrant {
        require(idToMarketItem[itemId].sold == 2, "Item has not been sold");
        require(price > 0, "Price must be greater than 0");
        require(
            listingPrice == msg.value,
            "Value must be equal to listing price"
        );
        require(
            marketType == 1 || marketType == 2,
            "marketType must be either Auction or Fixed"
        );

        IERC721(idToMarketItem[itemId].nftContract).transferFrom(
            msg.sender,
            address(this),
            idToMarketItem[itemId].tokenId
        );

        idToMarketItem[itemId].sold = 1;
        idToMarketItem[itemId].price = price;
        idToMarketItem[itemId].marketType = marketType;
        idToMarketItem[itemId].seller = payable(msg.sender);
        idToMarketItem[itemId].owner = payable(address(this));
        idToMarketItem[itemId].currentBid = 0;
        payable(owner()).transfer(listingPrice);
    }

    /* Creates the sale of a marketplace item */
    /* Transfers ownership of the item, as well as funds between parties */
    function createMarketSale(address nftContract, uint256 itemId)
        public
        payable
        nonReentrant
    {
        uint256 price = idToMarketItem[itemId].price;
        uint256 tokenId = idToMarketItem[itemId].tokenId;
        require(
            msg.value == price,
            "Please submit the asking price in order to complete the purchase"
        );

        (bool successful, ) = payable(idToMarketItem[itemId].seller).call{
            value: msg.value
        }("");
        require(successful, "Transfer to seller failed");

        IERC721(nftContract).transferFrom(address(this), msg.sender, tokenId);
        idToMarketItem[itemId].owner = payable(msg.sender);
        idToMarketItem[itemId].sold = 2;
        _itemsSold.increment();
    }

    /* Returns all unsold market items */
    function fetchMarketItems() public view returns (MarketItem[] memory) {
        uint256 itemCount = _itemIds.current();
        uint256 unsoldItemCount = _itemIds.current() - _itemsSold.current();
        uint256 currentIndex = 0;

        MarketItem[] memory items = new MarketItem[](unsoldItemCount);
        for (uint256 i = 0; i < itemCount; i++) {
            if (idToMarketItem[i + 1].owner == address(this)) {
                uint256 currentId = i + 1;
                MarketItem storage currentItem = idToMarketItem[currentId];
                items[currentIndex] = currentItem;
                currentIndex += 1;
            }
        }

        return items;
    }

    /* Returns only items that a user has purchased */
    function fetchMyNFTs() public view returns (MarketItem[] memory) {
        uint256 totalItemCount = _itemIds.current();
        uint256 itemCount = 0;
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < totalItemCount; i++) {
            if (idToMarketItem[i + 1].owner == msg.sender) {
                itemCount += 1;
            }
        }

        MarketItem[] memory items = new MarketItem[](itemCount);
        for (uint256 i = 0; i < totalItemCount; i++) {
            if (idToMarketItem[i + 1].owner == msg.sender) {
                uint256 currentId = i + 1;
                MarketItem storage currentItem = idToMarketItem[currentId];
                items[currentIndex] = currentItem;
                currentIndex += 1;
            }
        }
        return items;
    }

    /* Returns only items a user has created */
    function fetchItemsCreated() public view returns (MarketItem[] memory) {
        uint256 totalItemCount = _itemIds.current();
        uint256 itemCount = 0;
        uint256 currentIndex = 0;

        for (uint256 i = 0; i < totalItemCount; i++) {
            if (idToMarketItem[i + 1].seller == msg.sender) {
                itemCount += 1;
            }
        }

        MarketItem[] memory items = new MarketItem[](itemCount);
        for (uint256 i = 0; i < totalItemCount; i++) {
            if (idToMarketItem[i + 1].seller == msg.sender) {
                uint256 currentId = i + 1;
                MarketItem storage currentItem = idToMarketItem[currentId];
                items[currentIndex] = currentItem;
                currentIndex += 1;
            }
        }
        return items;
    }

    // Leasing NFTS inspired:

    function returnLeaseNFT(address nftContract, uint256 itemId)
        public
        payable
        nonReentrant
    {
        uint256 price = idToMarketItem[itemId].price;
        uint256 tokenId = idToMarketItem[itemId].tokenId;
        // for approval @amiya
        //IERC721(nftmarket).approve(idToMarketItem[itemId].seller, tokenId);
        /* require(
            //owner.balance == price,
            idToMarketItem[itemId].seller.balance == price,
            "Low Marketplace Balance to complete the purchase"
        );
        */
        IERC721(nftContract).transferFrom(
            msg.sender,
            //idToMarketItem[itemId].seller,
            address(this),
            tokenId
        );
        idToMarketItem[itemId].owner = idToMarketItem[itemId].seller;
        idToMarketItem[itemId].sold = false;
        _itemsSold.decrement();
        payable(owner).transfer(listingPrice);
    }
}
