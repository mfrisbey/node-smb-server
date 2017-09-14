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

var util = require('util');

var FileConnection = require('../../spi/fileconnection');
var RQLocalFileConnection = require('./localfileconnection');
var RQFile = require('./file');

/**
 * Creates an instance of RQFileConnection.
 *
 * @constructor
 * @this {RQFileConnection}
 */
var RQFileConnection = function (tree, sourceFileConnection) {
  if (!(this instanceof RQFileConnection)) {
    return new RQFileConnection(tree, sourceFileConnection);
  }

  FileConnection.call(this, sourceFileConnection.getFilePath(), tree);
  this.sourceFileConnection = sourceFileConnection;
  this.dirty = false;
  this.syncDone = false;
};

util.inherits(RQFileConnection, FileConnection);

/**
 * Async factory method for initializing a new RQFile from a remote file.
 *
 * @param {File} openFile file object
 * @param {RQTree} tree tree object
 * @param {Function} cb callback called with the bytes actually read
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {RQFile} cb.file RQFile instance
 */
RQFileConnection.createFileInstance = function (openFile, tree, cb) {
  cb(null, new RQFile(new RQFileConnection(tree, openFile.getFileConnection()), openFile, tree));
};

/**
 * Retrieves a value indicating whether the file is currently dirty.
 * @return {boolean} true if dirty, false if not.
 */
RQFileConnection.prototype.isDirty = function () {
  return this.dirty;
};

/**
 * Sets whether or not the file is dirty.
 * @param {boolean} isDirty New dirty value.
 */
RQFileConnection.prototype.setDirty = function (isDirty) {
  this.dirty = isDirty;
};

/**
 * Creates a new File instance using the connection's information.
 * @param {Tree} tree Will be given to the new File instance.
 * @return {File} Newly created instance.
 */
RQFileConnection.prototype.createFile = function (tree) {
  var openFile;

  if (this.sourceFileConnection instanceof RQLocalFileConnection) {
    openFile = this.sourceFileConnection.createFile(tree.local);
  } else {
    openFile = this.sourceFileConnection.createFile(tree.remote);
  }

  return new RQFile(this, openFile, tree);
};

/**
 * Retrieves a value indicating whether a re-sync attempt has already been done for this connection.
 * @returns {boolean} true if a re-sync has been done, false otherwise.
 */
RQFileConnection.prototype.isSyncDone = function () {
  return this.syncDone;
};

/**
 * Sets whether or not a sync attempt has been made for the connection.
 * @param {Boolean} syncDone The new value.
 */
RQFileConnection.prototype.setSyncDone = function (syncDone) {
  this.syncDone = syncDone;
};

/**
 * Retrieves the source FileConnection that the RQ connection is using.
 * @returns {FileConnection} The source connection.
 */
RQFileConnection.prototype.getSourceFileConnection = function () {
  return this.sourceFileConnection;
};

/**
 * Sets the source FileConnection that the RQ connection should use.
 * @param {FileConnection} source The new source.
 */
RQFileConnection.prototype.setSourceFileConnection = function (source) {
  this.sourceFileConnection = source;
};

module.exports = RQFileConnection;
