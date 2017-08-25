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

var ntstatus = require('../ntstatus');
var SMBError = require('../smberror');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var SMBContext = require('../smbcontext');

/**
 * Creates an instance of Share.
 *
 * @constructor
 * @this {Share}
 * @param {String} name share name
 * @param {Object} config configuration hash
 */
var Share = function (name, config) {
  if (!(this instanceof Share)) {
    return new Share(name, config);
  }
  // call the super constructor to initialize `this`
  EventEmitter.call(this);

  this.config = config || {};
  this.name = name;
  this.description = this.config.description || '';
};

util.inherits(Share, EventEmitter);

/**
 * Retrieves an array of event names that the share provides.
 *
 * @return {Array} The names of events (as strings) that the share emits.
 */
Share.prototype.getEvents = function () {
  if (this.config.events) {
    return this.config.events;
  } else {
    return [];
  }
};

/**
 * Return a flag indicating whether this is a named pipe share.
 *
 * @return {Boolean} <code>true</code> if this is a named pipe share;
 *         <code>false</code> otherwise, i.e. if it is a disk share.
 */
Share.prototype.isNamedPipe = function () {
  return false;
};

/**
 *
 * @param {Session} session
 * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
 * @param {Function} cb callback called when connected
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Share.prototype.connect = function (session, shareLevelPassword, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Disconnects the share.
 * @param {Function} cb called when the share is disconnected.
 */
Share.prototype.disconnect = function (cb) {
  // default implementation does nothing
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Creates a new instance of an spi tree and returns it
 * @return {Tree} The newly created tree instance.
 */
Share.prototype.createTree = function (context) {
  // default implementation does nothing
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

Share.prototype.createContext = function () {
  return new SMBContext();
};

module.exports = Share;

