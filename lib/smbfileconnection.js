/*
 *  Copyright 2015 Adobe Systems Incorporated. All rights reserved.
 *  This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License. You may obtain a copy
 *  of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under
 *  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *  OF ANY KIND, either express or implied. See the License for the specific language
 *  governing permissions and limitations under the License.
 */

'use strict';

var common = require('./common');

/**
 * Represents a file connection established by multiple SMB/SMB2 commands.
 *
 * @param {SMBServer} smbServer
 * @param {SMBShare} smbShare
 * @param {SMBTreeConnection} smbTreeConnection
 * @param {FileConnection} spiFileConnection
 * @param {Number} [fid = 0]
 * @param {Number} [createAction = FILE_OPENED]
 * @constructor
 */
function SMBFileConnection(smbServer, smbShare, smbTreeConnection, spiFileConnection, fid, createAction) {
  this.smbServer = smbServer;
  this.smbShare = smbShare;
  this.smbTreeConnection = smbTreeConnection;
  this.spiFileConnection = spiFileConnection;
  this.fid = fid === undefined ? 0 : fid;
  this.createAction = createAction === undefined ? common.FILE_OPENED : createAction;
}

/**
 * Retrieves the ID of the connected file.
 * @returns {Number} A file ID.
 */
SMBFileConnection.prototype.getFid = function () {
  return this.fid;
};

/**
 * Creates a new SPI File instance.
 * @param {Tree} Will be provided to the new File instance.
 * @returns {File} A new File instance.
 */
SMBFileConnection.prototype.createFileInstance = function (tree) {
  return this.spiFileConnection.createFile(tree);
};

/**
 * Retrieves the original create action for the file.
 * @returns {Number} A createAction.
 */
SMBFileConnection.prototype.getCreateAction = function () {
  return this.createAction;
};

module.exports = SMBFileConnection;
