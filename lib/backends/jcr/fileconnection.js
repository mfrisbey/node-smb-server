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
var async = require('async');

var FileConnection = require('../../spi/fileconnection');
var JCRFile = require('./file');

var SMBError = require('../../smberror');
var JCR = require('./constants');

/**
 * Creates an instance of JCRFileConnection.
 *
 * @constructor
 * @this {JCRFileConnection}
 */
var JCRFileConnection = function (filePath, tree, content, fileLength) {
  if (!(this instanceof JCRFileConnection)) {
    return new JCRFileConnection(filePath, tree, content, fileLength);
  }

  FileConnection.call(this, filePath, tree);
  this.content = content;
  this.fileLength = fileLength;

// needs flushing?
  this.dirty = false;
};

util.inherits(JCRFileConnection, FileConnection);

/**
 * Async factory method
 *
 * @param {String} filePath normalized file path
 * @param {JCRTree} tree tree object
 * @param {Object} [content=null] file meta data (null if unknown)
 * @param {Number} [fileLength=-1] file length (-1 if unknown)
 * @param {Function} cb callback called with the result
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {JCRFile} cb.file JCRFile instance
 */
JCRFileConnection.createFileInstance = function (filePath, tree, content, fileLength, cb) {
  var logger = tree.getLogger();
  content = typeof content === 'object' ? content : null;
  fileLength = typeof fileLength === 'number' ? fileLength : -1;
  cb = arguments[arguments.length - 1];
  if (typeof cb !== 'function') {
    logger.error(new Error('JCRFile.createInstance: called without callback'));
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
    } else if (!tree.share.isFilePrimaryType(content[JCR.JCR_PRIMARYTYPE])) {
      // folder has length 0
      callback(null, content, 0);
    } else if (typeof content[JCR.JCR_CONTENT][JCR.JCR_DATA_LENGTH] === 'number') {
      callback(null, content, content[JCR.JCR_CONTENT][JCR.JCR_DATA_LENGTH]);
    } else {
      // last resort: send a separate request for file length
      tree.fetchFileLength(filePath, function (err, length) {
        if (err) {
          callback(err);
        } else {
          callback(null, content, length);
        }
      });
    }
  }

  async.seq(getContent, getFileLength)(function (err, metaData, length) {
    if (err) {
      cb(SMBError.fromSystemError(err, 'unable to create file instance due to unexpected error ' + filePath));
    } else {
      cb(null, new JCRFile(new JCRFileConnection(filePath, tree, metaData, length), tree));
    }
  });
};

/**
 * Retrieves the file's description content.
 * @returns {object} Content containing the file's information.
 */
JCRFileConnection.prototype.getContent = function () {
  return this.content;
};

/**
 * Sets the content that the file will use for metadata.
 * @param {object} content The new content.
 */
JCRFileConnection.prototype.setContent = function (content) {
  this.content = content;
};

/**
 * Retrieves the file's length.
 * @returns {Integer}
 */
JCRFileConnection.prototype.getFileLength = function () {
  return this.fileLength;
};

/**
 * Sets the file's length.
 * @param {Integer} fileLength The new length.
 */
JCRFileConnection.prototype.setFileLength = function (fileLength) {
  this.fileLength = fileLength;
};

/**
 * Retrieves a value indicating whether the file is dirty or not.
 * @returns {boolean} true if dirty, otherwise false.
 */
JCRFileConnection.prototype.isDirty = function () {
  return dirty;
};

/**
 * Sets whether or not the file is dirty.
 * @param {boolean} dirty New dirty value.
 */
JCRFileConnection.prototype.setDirty = function (dirty) {
  this.dirty = dirty;
};

/**
 * Creates a new File instance using the connection's information.
 * @param {Tree} tree Will be given to the new File instance.
 * @return {File} Newly created instance.
 */
JCRFileConnection.prototype.createFile = function (tree) {
  new JCRFile(this, tree);
};

module.exports = JCRFileConnection;
