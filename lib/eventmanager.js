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

/**
 * The EventManager class ensures that events are emitted no more than a specified interval of time. This is to
 * prevent certain key events from being sent an unreasonable number of times in a short period.
 * @param {Object} options Controls how the event manager behaves.
 * @constructor
 */
function EventManager(options) {
  options = options || {};
  this.clearEvents();
}

/**
 * Internally checks to see if the time interval has elapsed, and sends the event if necessary.
 * @param {EventEmitter} emitter Will be used to emit the event.
 * @param {String} eventName Will be the name of the event that is sent.
 * @param {Object} eventData Will be provided as the data for the event that is sent.
 * @param {Integer} lastSent Timestamp of the last time the event was sent.
 * @param {Integer} timeout The amount of time (in milliseconds) that must have elapsed since the last send.
 * @returns {number} If truthy, the new timestamp for the last time the event was sent.
 * @private
 */
function _emitEvent(emitter, eventName, eventData, lastSent, timeout) {
  emitter.emit(eventName, eventData);
}

/**
 * Clears all sent events registered by the event manager.
 */
EventManager.prototype.clearEvents = function () {
  this.events = {};
  this.describedEvents = {};
};

/**
 * Flags an event as having been emit, without actually emitting the event.
 * @param {String} eventName The name of the event to flag.
 */
EventManager.prototype.registerEventEmit = function (eventName) {
  this.events[eventName] = new Date().getTime();
};

/**
 * Flags a described event as having been emit, without actually emitting the event.
 * @param {String} eventDescriber Secondary value to be used in conjunction with eventName.
 * @param {String} eventName The name of the event to flag.
 */
EventManager.prototype.registerDescribedEventEmit = function (eventDescriber, eventName) {
  if (!this.describedEvents[eventName]) {
    this.describedEvents[eventName] = {};
  }
  this.describedEvents[eventName][eventDescriber] = new Date().getTime();
};

/**
 * Retrieves the timestamp when a given event was last sent.
 * @param {String} eventName The name of the event.
 * @returns {Number} A timestamp, or false if the event has not be sent.
 */
EventManager.prototype.getLastEventEmit = function (eventName) {
  if (this.events[eventName]) {
    return this.events[eventName];
  }
  return false;
};

/**
 * Retrieves the timestamp when a given described event was last sent.
 * @param {String} eventDescriber Secondary value to be used in conjunction with eventName.
 * @param {String} eventName The name of the event.
 * @returns {Number} A timestamp, or false if the event has not be sent.
 */
EventManager.prototype.getLastDecribedEventEmit = function (eventDescriber, eventName) {
  if (this.describedEvents[eventName]) {
    if (this.describedEvents[eventName][eventDescriber]) {
      return this.describedEvents[eventName][eventDescriber];
    }
  }
  return false;
};

/**
 * Emits an event, but only if a given amount of time has passed since the last time the event was emitted.
 * @param {EventEmitter} emitter Will be used to emit the event.
 * @param {String} eventName Will be the name of the event that is sent.
 * @param {Object} eventData Will be provided as the data for the event that is sent.
 * @param {Integer} timeout The amount of time (in milliseconds) that must have elapsed since the last send.
 */
EventManager.prototype.emitEvent = function (emitter, eventName, eventData, timeout) {
  var lastSent = 0;
  if (this.events[eventName]) {
    lastSent = this.events[eventName];
  }
  if (this.shouldSendEvent(eventName, timeout)) {
    _emitEvent.call(this, emitter, eventName, eventData, lastSent, timeout);
    this.registerEventEmit(eventName);
  }
};

/**
 * Emits an event, but only if a given amount of time has passed since the last time the event was emitted. Uses a
 * secondary describer for cases where an event itself can be sent multiple times, but only once per interval for a
 * given value.
 * @param {EventEmitter} emitter Will be used to emit the event.
 * @param {String} eventDescriber Secondary value to be used in conjunction with eventName to limit emits.
 * @param {String} eventName Will be the name of the event that is sent.
 * @param {Object} eventData Will be provided as the data for the event that is sent.
 * @param {Integer} timeout The amount of time (in milliseconds) that must have elapsed since the last send.
 */
EventManager.prototype.emitDescribedEvent = function (emitter, eventDescriber, eventName, eventData, timeout) {
  var lastSent = 0;
  if (this.describedEvents[eventName]) {
    if (this.describedEvents[eventName][eventDescriber]) {
      lastSent = this.describedEvents[eventName][eventDescriber];
    }
  } else {
    this.describedEvents[eventName] = {};
  }
  if (this.shouldSendDescribedEvent(eventDescriber, eventName, timeout)) {
    _emitEvent.call(this, emitter, eventName, eventData, lastSent, timeout);
    this.registerDescribedEventEmit(eventDescriber, eventName);
  }
};

function _isExpired(lastSent, timeout) {
  var now = new Date().getTime();
  return (now - lastSent > timeout);
}

/**
 * Retrieves a value indicating whether or not a given event should be sent or not.
 * @param {string} eventName The name of the event to send.
 * @param {number} timeout The amount of time (in milliseconds) that must have elapsed since the last send.
 * @returns {boolean} True if the event should be sent, false otherwise.
 */
EventManager.prototype.shouldSendEvent = function (eventName, timeout) {
  var lastSent = 0;
  if (this.events[eventName]) {
    lastSent = this.events[eventName];
  }

  return _isExpired(lastSent, timeout);
};

/**
 * Retrieves a value indicating whether or not a given described event should be sent or not.
 * @param {string} eventName The name of the event to send.
 * @param {number} timeout The amount of time (in milliseconds) that must have elapsed since the last send.
 * @returns {boolean} True if the event should be sent, false otherwise.
 */
EventManager.prototype.shouldSendDescribedEvent = function (eventDescriber, eventName, timeout) {
  var lastSent = 0;
  if (this.describedEvents[eventName]) {
    if (this.describedEvents[eventName][eventDescriber]) {
      lastSent = this.describedEvents[eventName][eventDescriber];
    }
  }
  return _isExpired(lastSent, timeout);
};

module.exports = new EventManager({});
