/*
 *  Copyright 2017 Adobe Systems Incorporated. All rights reserved.
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

var ntstatus = require('./ntstatus');

var loggers = require('winston').loggers;
var uuid = require('uuid');

/**
 * Represents the context of an SMB command, useful e.g. for debugging and logging
 */
function SMBContext() {
  this.options = {};
  this.logs = {};
  this.requestId = uuid.v4();
}

SMBContext.prototype.wrapContextCallback = function (options, cb) {
  var self = this;
  var optionStr = JSON.stringify(options);
  self.smbcmd().info('-> %s', optionStr);
  return function (result) {
    var status = 'UNKNOWN';
    if (result) {
      if (result.status || result.status === 0) {
        status = ntstatus.STATUS_TO_STRING[result.status];
      }
    }
    self.smbcmd().info('<- %s %s', status, optionStr);
    cb(result);
  };
};

/**
 * Formats a log entry's message by prepending the context's label and request id.
 * @param {Array} toFormat Arguments provided to a log method.
 * @returns {Array} The newly formated message.
 * @private
 */
function _formatArguments(toFormat) {
  var message = toFormat[0];
  toFormat[0] = this.name + ' ' + this.label + ' ' + this.requestId + ' ' + message;
  return toFormat;
}

function WrappedLog(wrapped, name, label, requestId) {
  this.wrapped = wrapped;
  this.name = name;
  this.label = label;
  this.requestId = requestId;
}

WrappedLog.prototype.debug = function () {
  this.wrapped.debug.apply(this.wrapped, _formatArguments.call(this, arguments));
};

WrappedLog.prototype.info = function () {
  this.wrapped.info.apply(this.wrapped, _formatArguments.call(this, arguments));
};

WrappedLog.prototype.warn = function () {
  this.wrapped.warn.apply(this.wrapped, _formatArguments.call(this, arguments));
};

WrappedLog.prototype.error = function () {
  this.wrapped.error.apply(this.wrapped, _formatArguments.call(this, arguments));
};

function _getLog(name) {
  if (!this.logs[name]) {
    this.logs[name] = new WrappedLog(loggers.get(name), name, this.getLabel(), this.requestId);
  }
  return this.logs[name];
}

/**
 * Retrieves the context's request ID.
 * @returns {string} A request ID.
 */
SMBContext.prototype.getRequestId = function () {
  return this.requestId;
};

/**
 * Retrieves the arbitrary label assigned to the context.
 * @returns {String} The context's label.
 */
SMBContext.prototype.getLabel = function () {
  return this.options.label || 'default';
};

/**
 * Configures the context so that it will not use a request ID.
 * @returns {SMBContext} The context.
 */
SMBContext.prototype.requestless = function () {
  this.requestId = '0';
  return this;
};

/**
 * Configures the context to use a given label.
 * @param {String} label The arbitrary lable assigned to the context.
 * @returns {SMBContext} The context.
 */
SMBContext.prototype.withLabel = function (label) {
  this.options.label = label;
  return this;
};

/**
 * Configures the request id to be associated with the context.
 * @param {string} requestId The request id to use.
 * @returns {SMBContext} The context.
 */
SMBContext.prototype.withRequestId = function (requestId) {
  this.requestId = requestId;
  return this;
};

/**
 * Writes a debug-level message to the context's default logs. Supports string formatting where the first argument
 * is the message and subsequent arguments will be used for formatting.
 */
SMBContext.prototype.debug = function () {
  var defLog = this.default();
  defLog.debug.apply(defLog, arguments);
};

/**
 * Writes an info-level message to the context's default logs. Supports string formatting where the first argument
 * is the message and subsequent arguments will be used for formatting.
 */
SMBContext.prototype.info = function () {
  var defLog = this.default();
  defLog.info.apply(defLog, arguments);
};

/**
 * Writes a warn-level message to the context's default logs. Supports string formatting where the first argument
 * is the message and subsequent arguments will be used for formatting.
 */
SMBContext.prototype.warn = function () {
  var defLog = this.default();
  defLog.warn.apply(defLog, arguments);
};

/**
 * Writes an error-level message to the context's default logs. Supports string formatting where the first argument
 * is the message and subsequent arguments will be used for formatting.
 */
SMBContext.prototype.error = function () {
  var defLog = this.default();
  defLog.error.apply(defLog, arguments);
};

/**
 * Retrieves the context's default logs.
 * @return {Object} A log object that can be used in place of common loggers such as winston.
 */
SMBContext.prototype.default = function () {
  return _getLog.call(this, 'default');
};

/**
 * Retrieves the context's SPI logs.
 * @return {Object} A log object that can be used in place of common loggers such as winston.
 */
SMBContext.prototype.spi = function () {
  return _getLog.call(this, 'spi');
};

/**
 * Retrieves the context's request logs.
 * @return {Object} A log object that can be used in place of common loggers such as winston.
 */
SMBContext.prototype.request = function () {
  return _getLog.call(this, 'request');
};

/**
 * Retrieves the context's performance logs.
 * @return {Object} A log object that can be used in place of common loggers such as winston.
 */
SMBContext.prototype.perf = function () {
  return _getLog.call(this, 'perf');
};

/**
 * Retrieves the context's RQ logs.
 * @return {Object} A log object that can be used in place of common loggers such as winston.
 */
SMBContext.prototype.rq = function () {
  return _getLog.call(this, 'rq');
};

/**
 * Retrieves the context's SMB logs.
 * @return {Object} A log object that can be used in place of common loggers such as winston.
 */
SMBContext.prototype.smb = function () {
  return _getLog.call(this, 'smb');
};

/**
 * Retrieves the context's SMB CMD logs.
 * @return {Object} A log object that can be used in place of common loggers such as winston.
 */
SMBContext.prototype.smbcmd = function () {
  return _getLog.call(this, 'smbcmd');
};

module.exports = SMBContext;
