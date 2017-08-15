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

var ntstatus = require('../ntstatus');

function executeHandler(command, handler, context, msg, commandId, commandParams, commandData, commandParamsOffset, commandDataOffset, connection, server, cb) {
  var processResult = function (result, description) {
    description = description || '[no description]';
    if (!result) {
      cb(result);
    } else {
      var status = 'UNKNOWN';
      if (result.status || result.status === 0) {
        status = ntstatus.STATUS_TO_STRING[result.status];
      }
      context.smbcmd().info('<- %s %s %s', status, command, description);
      cb(result);
    }
  };
  var beginProcess = function (description) {
    description = description || '[no description]';
    context.smbcmd().info('-> %s %s', command, description);
  };
  // process command
  if (handler.handle) {
    // new version of handle takes a context object and provides an opportunity for the handler to give a
    // meaningful description of the object the handler is processing (like a file path)
    var cmdDesc;
    handler.handle(context, msg, commandId, commandParams, commandData, commandParamsOffset, commandDataOffset, connection, server,
      function (description, descCb) {
        cmdDesc = description;
        beginProcess(cmdDesc);
        descCb();
      },
      function (result) {
        processResult(result, cmdDesc);
      }
    );
  } else {
    // old version does not take context or provide a description
    beginProcess();
    handler(msg, commandId, commandParams, commandData, commandParamsOffset, commandDataOffset, connection, server, function (result) {
      processResult(result);
    });
  }
}

module.exports = executeHandler;
