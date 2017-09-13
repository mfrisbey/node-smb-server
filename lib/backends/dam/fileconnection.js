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

var JCRFileConnection = require('../jcr/fileconnection');
var DAMFile = require('./file');

var logger = require('winston').loggers.get('spi');
var async = require('async');

var DAM = require('./constants');
var SMBError = require('../../smberror');
var ntstatus = require('../../ntstatus');

/**
 * Creates an instance of DAMFileConnection.
 *
 * @constructor
 * @this {DAMFileConnection}
 */
var DAMFileConnection = function (filePath, tree, content, fileLength) {
  if (!(this instanceof DAMFileConnection)) {
    return new DAMFileConnection(filePath, tree, content, fileLength);
  }

  JCRFileConnection.call(this, filePath, tree, content, fileLength);
};

util.inherits(DAMFileConnection, JCRFileConnection);

/**
 * Async factory method
 *
 * @param {String} filePath normalized file path
 * @param {DAMTree} tree tree object
 * @param {Object} [content=null] file meta data (null if unknown)
 * @param {Number} [fileLength=-1] file length (-1 if unknown)
 * @param {Function} cb callback called with the bytes actually read
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {DAMFile} cb.file DAMFile instance
 */
DAMFileConnection.createFileInstance = function (filePath, tree, content, fileLength, cb) {
  content = typeof content === 'object' ? content : null;
  fileLength = typeof fileLength === 'number' ? fileLength : -1;
  cb = arguments[arguments.length - 1];
  if (typeof cb !== 'function') {
    logger.error(new Error('DAMFile.createInstance: called without callback'));
    cb = function () {};
  }

  function getContent(callback) {
    if (content) {
      callback(null, content);
    } else {
      tree.share.getContent(filePath, false, function (err, content) {
        if (content) {
          callback(err, content);
        } else {
          callback(err || 'not found: ' + filePath);
        }
      });
    }
  }

  function getFileLength(content, callback) {
    if (fileLength > -1) {
      callback(null, content, fileLength);
    } else if (tree.share.isFolderClass(content)) {
      // folder has length 0
      callback(null, content, 0);
    } else {
      callback(null, content, content[DAM.PROPERTIES][DAM.ASSET_SIZE] || 0);
    }
  }

  async.seq(getContent, getFileLength)(function (err, metaData, length) {
    if (err) {
      logger.error('unexpected error while retrieving content for file %s', filePath, err);
      cb(new SMBError(ntstatus.STATUS_NO_SUCH_FILE, 'cannot get content for file because it was not found ' + filePath));
    } else {
      cb(null, new DAMFile(new DAMFileConnection(filePath, tree, metaData, length), tree));
    }
  });
};

/**
 * Creates a new File instance using the connection's information.
 * @param {Tree} tree Will be given to the new File instance.
 * @return {File} Newly created instance.
 */
DAMFileConnection.prototype.createFile = function (tree) {
  return new DAMFile(this, tree);
};

module.exports = DAMFileConnection;
