/*
 *  Copyright 2016 Adobe Systems Incorporated. All rights reserved.
 *  This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License. You may obtain a copy
 *  of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under
 *  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *  OF ANY KIND, either express or implied. See the License for the specific language
 *  governing permissions and limitations under the License.
 */

var RQCommon = require('./rq-common');

describe('RQShare', function () {
  var c;

  beforeEach(function () {
    c = new RQCommon();
  });

  describe('Events', function () {
    it('testDownloadAssetEvent', function (done) {
      c.addFile(c.remoteTree, '/testdownload.jpg', function () {
        c.expectLocalFileExist('/testdownload.jpg', false, false, function () {
          c.testShare.on('shareEvent', function (data) {
            if (data.event == 'downloadend') {
              // there are timing issues between the completion of the request and when this event is emitted. Set a
              // timeout to allow the download to finish up
              setTimeout(function () {
                c.expectLocalFileExist('/testdownload.jpg', true, false, function () {
                  c.expectQueuedMethod('/', 'testdownload.jpg', false, done);
                });
              }, 500);
            }
          });
          c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/testdownload.jpg'});
        });
      });
    });
  });

  it('testDownloadAssetExists', function (done) {
    c.addCachedFile('/testexists.jpg', function () {
      var eventCalled = false;
      c.testShare.on('shareEvent', function () {
        eventCalled = true;
      });
      c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/testexists.jpg'});
      setTimeout(function () {
        expect(eventCalled).toBeFalsy();
        done();
      }, 500);
    });
  });

  it('testDownloadAssetExistsOpenIfExists', function (done) {
    c.addCachedFile('/testexists.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'openasset') {
          expect(data.data.path).toEqual('/testexists.jpg');
          done();
        }
      });
      c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/testexists.jpg', openIfExists: true});
    });
  });

  it('testUploadAssetEvent', function (done) {
    c.addQueuedFile('/testupload.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'syncfileend') {
          c.expectLocalFileExist('/testupload.jpg', true, false, function () {
            c.expectQueuedMethod('/', 'testupload.jpg', false, function () {
              c.remoteTree.exists('/testupload.jpg', function (err, exists) {
                expect(err).toBeFalsy();
                expect(exists).toBeTruthy();
                done();
              });
            });
          });
        }
      });
      c.testShare.onServerEvent(c.testContext, 'uploadasset', {path: '/testupload.jpg'});
    });
  });

  it('testCancelUpload', function (done) {
    c.addQueuedFile('/testcancel.jpg', function () {
      c.registerLocalPath('/testcancel.jpg', function (filePath, fileData, fileCb) {
        c.testShare.onServerEvent(c.testContext, 'cancelupload', {path: '/testcancel.jpg'});
        fileCb(null, fileData);
      });
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'syncfileabort') {
          c.remoteTree.exists('/testcancel.jpg', function (err, exists) {
            expect(err).toBeFalsy();
            expect(exists).toBeFalsy();
            c.expectLocalFileExist('/testcancel.jpg', true, true, function () {
              c.expectQueuedMethod('/', 'testcancel.jpg', 'PUT', done);
            });
          });
        }
      });
      c.testShare.onServerEvent(c.testContext, 'uploadasset', {path: '/testcancel.jpg'});
    });
  });
});
