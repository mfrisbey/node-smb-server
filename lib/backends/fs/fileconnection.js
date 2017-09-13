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
var Path = require('path');
var fs = require('fs');

var FileConnection = require('../../spi/fileconnection');
var FSFile = require('./file');
var SMBError = require('../../smberror');

/**
 * Creates an instance of FSFileConnection.
 *
 * @constructor
 * @this {FSFileConnection}
 */
var FSFileConnection = function (filePath, tree, stats) {
  if (!(this instanceof FSFileConnection)) {
    return new FSFileConnection(filePath, tree, stats);
  }

  FileConnection.call(this, filePath, tree);
  this.stats = stats;
  this.realPath = FSFileConnection.buildRealPath(tree, filePath);
  // extract file permissions from stats.mode, convert to octagonal, check if owner write permission bit is set (00200)
  // see http://stackoverflow.com/questions/11775884/nodejs-file-permissions
  this.writeable = !!(2 & parseInt((stats.mode & parseInt('777', 8)).toString(8)[0]));
};

util.inherits(FSFileConnection, FileConnection);

/**
 * Retrieves the real, disk path to a file.
 * @param {string} tree The file's tree. The tree's config will be used to determine the local path.
 * @param {string} filePath The server's file path.
 */
FSFileConnection.buildRealPath = function (tree, filePath) {
  return Path.join(tree.share.path, filePath);
};

/**
 * Async factory method
 *
 * @param {String} filePath normalized file path
 * @param {FSTree} tree tree object
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {FSFile} cb.file FSFile instance
 */
FSFileConnection.createFileInstance = function (filePath, tree, cb) {
  var realPath = FSFileConnection.buildRealPath(tree, filePath);
  fs.stat(realPath, function (err, stats) {
    if (err) {
      cb(SMBError.fromSystemError(err, 'unable to create file due to unexpected error ' + filePath));
    } else {
      cb(null, new FSFile(new FSFileConnection(filePath, tree, stats), tree));
    }
  });
};

/**
 * Retrieves the files fs.stat information.
 * @returns {object} File stats.
 */
FSFileConnection.prototype.getStats = function () {
  return this.stats;
};

/**
 * Updates the stats that are being used by the file connection.
 * @param {object} stats New stats to use.
 */
FSFileConnection.prototype.setStats = function (stats) {
  this.stats = stats;
};

/**
 * Retrieves the full path to the file on disk.
 * @returns {String} A file path.
 */
FSFileConnection.prototype.getRealPath = function () {
  return this.realPath;
};

/**
 * Retrieves a value indicating whether or not the file is writeable.
 * @returns {boolean} true if writeable, false if not.
 */
FSFileConnection.prototype.getWriteable = function () {
  return this.writeable;
};

/**
 * Creates a new File instance using the connection's information.
 * @param {Tree} tree Will be given to the new File instance.
 * @return {File} Newly created instance.
 */
FSFileConnection.prototype.createFile = function (tree) {
  return new FSFile(this, tree);
};

module.exports = FSFileConnection;
