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
var RQLocalFile = require('./localfile');

/**
 * Creates an instance of RQLocalFileConnection.
 *
 * @constructor
 * @this {RQLocalFileConnection}
 */
var RQLocalFileConnection = function (tree, source, cacheData) {
  if (!(this instanceof RQLocalFileConnection)) {
    return new RQLocalFileConnection(tree, source, cacheData);
  }

  FileConnection.call(this, source.getFilePath(), tree);
  this.source = source;
  this.cacheData = cacheData || {};
  this.dirty = source.dirty ? true : false;

  if (!this.cacheData.local) {
    this.cacheData['local'] = {};
  }

  if (!this.cacheData.remote) {
    this.cacheData['remote'] = {};
  }
};

util.inherits(RQLocalFileConnection, FileConnection);

/**
 * Creates a new instance of an RQLocalFile from required information.
 * @param {File} sourceFile The source file whose information will be used for much of the local file's functionality.
 * @param {File} infoFile A file that will be read and whose contents will be used to provide certain info about the
 *  local file.
 * @param {Tree} tree The tree to which the local file belongs.
 * @param {function} cb Will be invoked when the operation is complete.
 * @param {Error} cb.err Will be truthy if there were errors during the operation.
 * @param {RQLocalFile} cb.file Will be the new file instance.
 */
RQLocalFileConnection.createFileInstance = function (sourceFile, infoFile, tree, cb) {
  var sourceFileConnection = sourceFile.getFileConnection();
  if (infoFile) {
    // only try to read cache info file if there is one.
    RQLocalFile.readCacheInfo(infoFile, function (err, cacheInfo) {
      if (err) {
        cb(err);
      } else {
        cb(null, new RQLocalFile(new RQLocalFileConnection(tree, sourceFileConnection, cacheInfo), sourceFile, tree));
      }
    });
  } else {
    cb(null, new RQLocalFile(new RQLocalFileConnection(tree, sourceFileConnection, {}), sourceFile, tree));
  }
};

/**
 * Creates a new File instance using the connection's information.
 * @param {RQLocalTree} tree Will be given to the new File instance.
 * @return {File} Newly created instance.
 */
RQLocalFileConnection.prototype.createFile = function (tree) {
  return new RQLocalFile(this, this.source.createFile(tree.getSourceTree()), tree);
};

/**
 * Retrieve's the file's cache data.
 * @returns {object} Cache data.
 */
RQLocalFileConnection.prototype.getCacheData = function () {
  return this.cacheData;
};

/**
 *
 * @returns {boolean|*}
 */
RQLocalFileConnection.prototype.isDirty = function () {
  return this.dirty;
};

module.exports = RQLocalFileConnection;
