/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const { buildCCPOrg, buildWallet } = require('../../test-application/javascript/AppUtil.js');
const { buildCAClient, enrollAdmin, registerAndEnrollUser } = require('../../test-application/javascript/CAUtil.js');
let roles = [];

let channelName = 'mychannel';
let chaincodeName = 'basic';
const mspConsumer = 'ConsumerMSP', mspRetailer='RetailerMSP', mspDistributor='DistributorMSP', mspManufacturer='ManufacturerMSP';
const walletPath = path.join(__dirname, 'wallet');
const UserId = 'User';

function prettyJSONString(inputString) {
	return JSON.stringify(JSON.parse(inputString), null, 2);
}

async function GetAttributes(wallet, ca, role){
	const provider = wallet.getProviderRegistry().getProvider('X.509');
	const adminIdentity = await wallet.get(ca.getCaName());

	const adminUser = await provider.getUserContext(adminIdentity, 'admin');
	const identityService = ca.newIdentityService();
	const identities = await (await identityService.getAll(adminUser)).result.identities;

	console.log(identities);
	identities.forEach(e => {
		// console.log(e);
		const result = e.attrs.filter(el => {
			if(el.value == role || el.name == 'affiliation'){
				return el;
			}
		});
		if(result.length >= 2){
			result.forEach( attr => {
				if(attr.name == 'affiliation'){
					roles.push(attr.value);
				}
			})
		};
	});
}

// async function GetRoles(wallet, caClient1, caClient2, caClient3, caClient4, peers, role){
async function GetRoles(peers, roles){
	let endorsers = [];
	// await GetAttributes(wallet, caClient1, role);			
	// await GetAttributes(wallet, caClient2, role);
	// await GetAttributes(wallet, caClient3, role);
	// await GetAttributes(wallet, caClient4, role);
	if(roles.length){
		roles.forEach(role => {
			peers.forEach(peer => {
				if(peer.name.includes(role) && peer.name.includes('peer0')){
					endorsers.push(peer);
				}
			});
		});
		console.log(roles);
	}else{
		new Error("Given Role is not a valid attribute.");
	}
	return endorsers;
}

async function createProduct(contract, endorser){
	let trans = contract.createTransaction('createProduct');
	if(endorser)
		trans.setEndorsingPeers(endorser);
	trans.submit('Product7', 'Blue', 300, 'Manufacturer', 150);
}

async function main() {
	try {
		const ccp1 = buildCCPOrg('consumer');
		const caClient1 = buildCAClient(FabricCAServices, ccp1, 'ca.consumer.example.com');
		const ccp2 = buildCCPOrg('retailer');
		const caClient2 = buildCAClient(FabricCAServices, ccp2, 'ca.retailer.example.com');
		const ccp3 = buildCCPOrg('distributor');
		const caClient3 = buildCAClient(FabricCAServices, ccp3, 'ca.distributor.example.com');
		const ccp4 = buildCCPOrg('manufacturer');
		const caClient4 = buildCAClient(FabricCAServices, ccp4, 'ca.manufacturer.example.com');
		const wallet = await buildWallet(Wallets, walletPath);

		// in a real application this would be done on an administrative flow, and only once
		await enrollAdmin(caClient1, wallet, mspConsumer);
		await enrollAdmin(caClient2, wallet, mspRetailer);
		await enrollAdmin(caClient3, wallet, mspDistributor);
		await enrollAdmin(caClient4, wallet, mspManufacturer);

		// in a real application this would be done only when a new user was required to be added
		// and would be part of an administrative flow

		const gateway = new Gateway();
		await registerAndEnrollUser(caClient4, wallet, mspManufacturer, UserId, 'manufacturer.department1');	
		await gateway.connect(ccp4, { wallet, identity: UserId, discovery: { enabled: true, asLocalhost: true }});

		const network = await gateway.getNetwork(channelName);
		const contract = network.getContract(chaincodeName);
		const peers = network.getChannel().getEndorsers();
		
		console.log('\n--> Submit: InitLedger, function creates the initial set of products on the ledger');
		const endorser = await GetRoles(peers, ['manufacturer', 'distributor']);
		await contract.createTransaction('InitLedger').setEndorsingPeers(endorser).submit();
		console.log('*** Result: committed');
		
		console.log('\n--> Evaluate: GetAllProducts, function creates the initial set of products on the ledger');
		let result = await contract.evaluateTransaction('GetAllProducts');
		console.log(`*** Result: ${prettyJSONString(result.toString())}`);

		try{
			console.log('\n--> Submit: TransferProduct, function transfers the product from one owner to another.');
			result = await contract.evaluateTransaction('ReadProduct','product1');
			result = JSON.parse(result.toString());
			console.log("User is from: ", gateway.getIdentity().mspId, "\nOwner of product1: ", result['Owner']);
			if(gateway.getIdentity().mspId.includes(result['Owner'])){
				const endorser = await GetRoles(peers, ['consumer', 'retailer', 'distributor']);
				await contract.createTransaction('TransferProduct').setEndorsingPeers(endorser).submit('product1','Distributor');
				console.log('*** Result: product1 is transferred from Manufacturer to Distributor.');
			}
			else{
				console.log("Failed: You can't transfer the product because you are not the owner of this product product1");
			}
		}catch(err){
			console.log('Failed: ', err);
		}
		try{
			console.log('\n--> Submit: TransferProduct, function transfers the product from one owner to another.');
			result = await contract.evaluateTransaction('ReadProduct','product6');
			result = JSON.parse(result.toString());
			console.log("User is from: ", gateway.getIdentity().mspId, "\nOwner of product6: ", result['Owner']);
			if(gateway.getIdentity().mspId.includes(result['Owner'])){
				const endorser = await GetRoles(peers, ['consumer', 'retailer', 'distributor']);
				await contract.createTransaction('TransferProduct').setEndorsingPeers(endorser).submit('product6','Consumer');
				console.log('*** Result: product6 is transferred from Manufacturer to Distributor.');
			}
			else{
				console.log("Failed: You can't transfer the product because you are not the owner of this product product6");
			}
		}catch(err){
			console.log('Failed: ', err);
		}
		gateway.disconnect();
	}catch(error){
		console.error(`Failed to run application: ${error}`);
	}
}

main();
