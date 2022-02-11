
   
const { expect } = require("chai");
const { ethers } = require("hardhat");

const normalizeBigNumber = (number) => ethers.BigNumber.from(number).toString();

beforeEach(async function () {
  const Market = await ethers.getContractFactory("NFTMarket");
  market = await Market.deploy();
  await market.deployed();
  marketAddress = market.address;

  const NFT = await ethers.getContractFactory("NFT");
  nft = await NFT.deploy(marketAddress);
  await nft.deployed();
  nftAddress = nft.address;

  const transaction = await nft.mintNFT("https://www.mytokenlocation.com");
  let tx = await transaction.wait();
  let event = tx.events[0];
  let value = event.args[2];
  tokenId = value.toNumber();

  const transaction2 = await nft.mintNFT("https://www.mytokenlocation.com");
  let tx2 = await transaction2.wait();
  let event2 = tx2.events[0];
  let value2 = event2.args[2];
  tokenId2 = value2.toNumber();
});

describe("NFT Contract", function () {
  it("Should create an NFT", async function () {
    const transaction = await nft.mintNFT("https://www.mytokenlocation.com");
    let tx = await transaction.wait();
    let event = tx.events[0];
    let value = event.args[2];
    let tokenId = value.toNumber();
    expect(tokenId).to.be.a("number");
  });
});

describe("Marketplace Contract", function () {
  it("Should set a listing price by owner", async function () {
    await market.setListingPrice(ethers.utils.parseEther("0.5"));
    const response = await market.getListingPrice();
    const listingPrice = ethers.utils.formatEther(normalizeBigNumber(response));
    expect(listingPrice).to.be.a("string");
    expect(listingPrice).to.equal("0.5");
  });

  it("Should create a market item for fixed and auction sale", async function () {
    await market.setListingPrice(ethers.utils.parseEther("0.5"));
    await market.createMarketItem(nftAddress, tokenId, ethers.utils.parseEther("10"), 1, {
      value: ethers.utils.parseEther("0.5"),
    });
    await market.createMarketItem(nftAddress, tokenId2, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });
    const response = await market.fetchMarketItems();
    const marketItems = response.map((item) => {
      // console.log({
      //   tokenId: ethers.BigNumber.from(item.tokenId).toString(),
      //   price: ethers.BigNumber.from(item.price).toString(),
      //   sold: ethers.BigNumber.from(item.sold).toString(),
      //   itemId:  ethers.BigNumber.from(item.itemId).toString(),
      //   currentBid: ethers.BigNumber.from(item.currentBid).toString(),
      //   marketType: ethers.BigNumber.from(item.marketType).toString(),
      // })
      return ethers.BigNumber.from(item.tokenId).toString();
    });
    expect(marketItems).to.include(normalizeBigNumber(tokenId));
    expect(marketItems).to.include(normalizeBigNumber(tokenId2));
  });

  it("Market bidding logic", async function () {
    await market.setListingPrice(ethers.utils.parseEther("0.5"));
    await market.createMarketItem(nftAddress, tokenId, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });

    const [owner, addr1, addr2] = await ethers.getSigners();

    // Should fail to bid if owner is the one bidding
    try {
      await market.bidForMarketItem(1, {
        value: ethers.utils.parseEther("10"),
      });
    } catch (error) {
      expect(error.message).to.equal(
        "VM Exception while processing transaction: reverted with reason string 'You cannot bid on your own item'"
      );
    }

    // Should fail to bid if the bid is not greater than 0
    try {
      await market.bidForMarketItem(1, {
        value: ethers.utils.parseEther("0"),
      });
    } catch (error) {
      expect(error.message).to.equal(
        "VM Exception while processing transaction: reverted with reason string 'Bid must be greater than 0'"
      );
    }

    // Should bid successfully
    await expect(
      market.connect(addr1).bidForMarketItem(1, {
        value: ethers.utils.parseEther("11"),
      })
    )
      .to.emit(market, "Bid")
      .withArgs(addr1.address, (11 * 10 ** 18).toString(), 1);

    // Should fail to bid if the bid is not greater than the current bid
    try {
      await market.connect(addr2).bidForMarketItem(1, {
        value: ethers.utils.parseEther("11"),
      });
    } catch (error) {
      expect(error.message).to.equal(
        "VM Exception while processing transaction: reverted with reason string 'Your bid must be greater than the current bid'"
      );
    }

    // Should submit a higher bid successfully
    await expect(
      market.connect(addr2).bidForMarketItem(1, {
        value: ethers.utils.parseEther("15"),
      })
    )
      .to.emit(market, "Bid")
      .withArgs(addr2.address, (15 * 10 ** 18).toString(), 1);

    // Should fail to bid if the cumulative bid is not greater than the current bid
    try {
      await market.connect(addr1).bidForMarketItem(1, {
        value: ethers.utils.parseEther("3"),
      });
    } catch (error) {
      expect(error.message).to.equal(
        "VM Exception while processing transaction: reverted with reason string 'Your bid must be greater than the current bid'"
      );
    }

    // Should bid cumulatively successfully
    await expect(
      market.connect(addr1).bidForMarketItem(1, {
        value: ethers.utils.parseEther("6"),
      })
    )
      .to.emit(market, "Bid")
      .withArgs(addr1.address, (17 * 10 ** 18).toString(), 1);
  });

  it("Should end auction", async function () {
    await market.setListingPrice(ethers.utils.parseEther("0.5"));
    await market.createMarketItem(nftAddress, tokenId, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });
    const [owner, addr1, addr2, addr3] = await ethers.getSigners();
    const oldBalanceResponse = await ethers.provider.getBalance(owner.address);
    const addr1OldBalanceResponse = await ethers.provider.getBalance(
      addr1.address
    );
    const addr2OldBalanceResponse = await ethers.provider.getBalance(
      addr2.address
    );
    const addr3OldBalanceResponse = await ethers.provider.getBalance(
      addr3.address
    );
    const oldBalance = ethers.BigNumber.from(oldBalanceResponse) / 10 ** 18;
    const addr1OldBalance =
      ethers.BigNumber.from(addr1OldBalanceResponse) / 10 ** 18;
    const addr2OldBalance =
      ethers.BigNumber.from(addr2OldBalanceResponse) / 10 ** 18;
    const addr3OldBalance =
      ethers.BigNumber.from(addr3OldBalanceResponse) / 10 ** 18;

    await market.connect(addr1).bidForMarketItem(1, {
      value: ethers.utils.parseEther("11"),
    });
    await market.connect(addr2).bidForMarketItem(1, {
      value: ethers.utils.parseEther("12"),
    });
    await market.connect(addr3).bidForMarketItem(1, {
      value: ethers.utils.parseEther("13"),
    });
    await market.connect(addr1).bidForMarketItem(1, {
      value: ethers.utils.parseEther("3"),
    });

    try {
      await market.connect(addr1).endAuction(1);
    } catch (error) {
      expect(error.message).to.equal(
        "VM Exception while processing transaction: reverted with reason string 'Ownable: Only auction owner can end auction'"
      );
    }

    // End Auction Successfully
    await market.endAuction(1);

    // Should fail to bid if the item is sold already
    try {
      await market.connect(addr1).bidForMarketItem(1, {
        value: ethers.utils.parseEther("10"),
      });
    } catch (error) {
      expect(error.message).to.equal(
        "VM Exception while processing transaction: reverted with reason string 'Item has already been sold'"
      );
    }

    // Token should be transferred to the winner
    const nftOwner = await nft.ownerOf(tokenId);
    expect(nftOwner).to.equal(addr1.address);

    // Funds should be transferred to the seller
    const response = await ethers.provider.getBalance(owner.address);
    const balance = ethers.BigNumber.from(response) / 10 ** 18;
    expect(balance - oldBalance).to.be.greaterThan(13.9);

    // Refunds should be sent to the bidders amd winning bid should be deducted from the winning bidder

    const addr1Response = await ethers.provider.getBalance(addr1.address);
    const addr2Response = await ethers.provider.getBalance(addr2.address);
    const addr3Response = await ethers.provider.getBalance(addr3.address);
    const addr1Balance = ethers.BigNumber.from(addr1Response) / 10 ** 18;
    const addr2Balance = ethers.BigNumber.from(addr2Response) / 10 ** 18;
    const addr3Balance = ethers.BigNumber.from(addr3Response) / 10 ** 18;

    expect(addr1OldBalance - addr1Balance).to.be.greaterThan(13.9);
    expect(addr2Balance.toFixed(2)).to.be.equal(addr2OldBalance.toFixed(2));
    expect(addr3Balance.toFixed(2)).to.be.equal(addr3OldBalance.toFixed(2));

    const item = await market.idToMarketItem(1);

    expect(normalizeBigNumber(item.sold)).to.be.equal("2");
    expect(normalizeBigNumber(item.currentBid)).to.be.equal("0");
    expect(ethers.BigNumber.from(item.sellPrice) / 10 ** 18).to.be.equal(14);
    expect(item.owner).to.be.equal(addr1.address);
  });

  it("Should resell marketItem", async function () {
    await market.setListingPrice(ethers.utils.parseEther("0.5"));

    await market.createMarketItem(nftAddress, tokenId, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });

    const [owner, addr1] = await ethers.getSigners();

    await market.connect(addr1).bidForMarketItem(1, {
      value: ethers.utils.parseEther("11"),
    });

    await market.endAuction(1);

    await nft.connect(addr1).setApprovalForAll(market.address, true);

    await market.connect(addr1).resellMarketItem(1, ethers.utils.parseEther("12"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });

    const item = await market.idToMarketItem(1);

    expect(normalizeBigNumber(item.sold)).to.be.equal("1");
    expect(normalizeBigNumber(item.currentBid)).to.be.equal("0");
    expect(ethers.BigNumber.from(item.price) / 10 ** 18).to.be.equal(12);
    expect(item.owner).to.be.equal(market.address);
  });

  it("Should create market sale", async function () {
    await market.setListingPrice(ethers.utils.parseEther("0.5"));
    await market.createMarketItem(nftAddress, tokenId, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });

    const [owner, addr1] = await ethers.getSigners();

    try {
      await market.connect(addr1).createMarketSale(nftAddress, 1, {
        value: ethers.utils.parseEther("1"),
      });
    } catch (error) {
      expect(error.message).to.equal(
        "VM Exception while processing transaction: reverted with reason string 'Please submit the asking price in order to complete the purchase'"
      );
    }

    await market.connect(addr1).createMarketSale(nftAddress, 1, {
      value: ethers.utils.parseEther("10"),
    });

    const item = await market.idToMarketItem(1);

    expect(normalizeBigNumber(item.sold)).to.be.equal("2");
    expect(item.owner).to.be.equal(addr1.address);
  });

  it("Should return all unsold market items", async function () {
    const [owner, addr1] = await ethers.getSigners();
    await market.setListingPrice(ethers.utils.parseEther("0.5"));
    await market.createMarketItem(nftAddress, tokenId, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });
    await market.createMarketItem(nftAddress, tokenId2, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });
    await market.connect(addr1).createMarketSale(nftAddress, 1, {
      value: ethers.utils.parseEther("10"),
    });

    const items = await market.fetchMarketItems();

    expect(items.length).to.be.equal(1);
  })

  it("Should return a user items", async function () {
    const [owner] = await ethers.getSigners();
    await market.setListingPrice(ethers.utils.parseEther("0.5"));
    await market.createMarketItem(nftAddress, tokenId, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });
    await market.createMarketItem(nftAddress, tokenId2, ethers.utils.parseEther("10"), 2, {
      value: ethers.utils.parseEther("0.5"),
    });

    const items = await market.fetchItemsCreated();

    expect(items.length).to.be.equal(2);
  })
});