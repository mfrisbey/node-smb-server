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
var RQTree = RQCommon.require(__dirname, '../../../../lib/backends/rq/tree');
var utils = RQCommon.require(__dirname, '../../../../lib/utils');

describe('RQTreeConnection', function () {
  var c;

  beforeEach(function () {
    c = new RQCommon();
  });

  it('testDownloadAsset', function (done) {
    c.addFile(c.remoteTree, '/download.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'downloadend') {
          setTimeout(function () {
            c.expectLocalFileExist('/download.jpg', true, false, done);
          }, 500);
        }
      });
      c.testShare.emit('downloadasset', {options: {path: '/download.jpg'}, context: c.testContext});
    });
  });
  
  it('testDownloadAssetExisting', function (done) {
    c.addCachedFile('/existing.jpg', function () {
      var sent = false;
      c.testShare.on('shareEvent', function () {
        sent = true;
      });
      c.testShare.emit('downloadasset', {options: {path: '/existing.jpg'}, context: c.testContext});
      setTimeout(function () {
        expect(sent).toBeFalsy();
        done();
      }, 500);
    });
  });

  it('testDownloadAssetCallback', function (done) {
    c.addFile(c.remoteTree, '/downloadcb.jpg', function () {
      c.testShare.emit('downloadasset', {options: {path: '/downloadcb.jpg'}, context: c.testContext, callback: function (err) {
        expect(err).toBeFalsy();
        c.expectLocalFileExist('/downloadcb.jpg', true, false, done);
      }});
    });
  });

  it('testDownloadAssetExistingForce', function (done) {
    c.addCachedFile('/existing.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'downloadend') {
          setTimeout(function () {
            c.expectLocalFileExist('/existing.jpg', true, false, done);
          }, 500);
        }
      });
      c.testShare.emit('downloadasset', {options: {path: '/existing.jpg', force: true}, context: c.testContext});
    });
  });

  it('testGetLinkedAssets', function (done) {
    var callback = function (err, assets) {
      expect(err).toBeFalsy();
      expect(assets).toBeTruthy();
      expect(assets.length).toEqual(2);
      expect(assets[0]).toEqual('/Volumes/DAM/we-retail/en/activities/biking/cycling_1.jpg');
      expect(assets[1]).toEqual('/Volumes/DAM/we-retail/en/activities/biking/cycling_2.jpg');
      done();
    };

    c.request.registerUrl(RQCommon.getHostRemotePrefix() + '/content/dam/testindesign.indd/jcr:content/metadata/xmpMM:Ingredients.1.json', function (options, cb) {
      cb(null, 200, '{"jcr:primaryType":"nt:unstructured","xmpNodeType":"xmpArray","xmpArraySize":2,"xmpArrayType":"rdf:Bag","1":{"jcr:primaryType":"nt:unstructured","stRef:filePath":"file:///Volumes/DAM/we-retail/en/activities/biking/cycling_1.jpg","stRef:instanceID":"xmp.iid:a2b73b7d-7b74-4c04-97e4-d219a148eead","stRef:maskMarkers":"None","stRef:toPart":"/","stRef:placedResolutionUnit":"Inches","stRef:linkCategory":"Content","stRef:linkForm":"ReferenceStream","xmpNodeType":"xmpStruct","stRef:placedYResolution":"300.00","stRef:documentID":"xmp.did:a2b73b7d-7b74-4c04-97e4-d219a148eead","stRef:fromPart":"/","stRef:placedXResolution":"300.00"},"2":{"jcr:primaryType":"nt:unstructured","stRef:filePath":"file:///Volumes/DAM/we-retail/en/activities/biking/cycling_2.jpg","stRef:instanceID":"xmp.iid:f13e7a82-e18b-48fd-bc67-e08bc04e22a3","stRef:maskMarkers":"None","stRef:toPart":"/","stRef:placedResolutionUnit":"Inches","stRef:linkCategory":"Content","stRef:linkForm":"ReferenceStream","xmpNodeType":"xmpStruct","stRef:placedYResolution":"300.00","stRef:documentID":"xmp.did:f13e7a82-e18b-48fd-bc67-e08bc04e22a3","stRef:fromPart":"/","stRef:placedXResolution":"300.00"}}');
    });

    c.testShare.emit('getlinkedassets', {context: c.testContext, options: {path: '/testindesign.indd'}, callback: callback});
  });

  it('testIsDownloaded', function (done) {
    c.addCachedFile('/testisdownloaded.jpg', function () {
      c.testShare.emit('isdownloaded', {context: c.testContext, options: {path: '/testisdownloaded.jpg'}, callback: function (err, downloaded) {
        expect(err).toBeFalsy();
        expect(downloaded).toBeTruthy();
        done();
      }});
    });
  });

  it('testIsDownloadedFalse', function (done) {
    c.testShare.emit('isdownloaded', {context: c.testContext, options: {path: '/testisnotdownloaded.jpg'}, callback: function (err, downloaded) {
      expect(err).toBeFalsy();
      expect(downloaded).toBeFalsy();
      done();
    }});
  });

  it('testCreateAssetOnChunk', function (done) {
    var date = new Date().getTime();
    c.fs.createEntityWithDatesSync('/uploadassetchunk.jpg', false, '0123456789', date, date);
    c.fs.truncate('/uploadassetchunk.jpg', 10 * 1024 * 1024, function (err) {
      expect(err).toBeFalsy();
      c.testShare.config.chunkUploadSize = 1;

      var start = false;
      var end = false;
      c.testShare.on('shareEvent', function (data) {
        if (data.event === 'syncfilestart') {
          start = true;
          expect(data.data.file).toEqual('/uploadassetchunk.jpg');
        } else if (data.event === 'syncfileend') {
          end = true;
          expect(data.data.file).toEqual('/uploadassetchunk.jpg');
        }
      });

      c.testShare.emit('createasset', {
        context: c.testContext,
        options: {
          path: '/uploadassetchunk_remote.jpg',
          file: '/uploadassetchunk.jpg',
          offset:  0,
          onChunk: function (nextOffset, totalSize, callback) {
            expect(nextOffset).toEqual(1024 * 1024);
            expect(totalSize).toEqual(10 * 1024 * 1024);
            callback(true);
          }
        }, callback: function (err) {
          expect(err).toBeFalsy();
          expect(start).toBeTruthy();
          expect(end).toBeTruthy();
          done();
        }
      });
    });
  });

  it('testCreateAssetOnChunkOffset', function (done) {
    var date = new Date().getTime();
    c.fs.createEntityWithDatesSync('/uploadassetchunk.jpg', false, '0123456789', date, date);
    c.fs.truncate('/uploadassetchunk.jpg', 10 * 1024 * 1024, function (err) {
      expect(err).toBeFalsy();
      c.testShare.config.chunkUploadSize = 1;
      c.testShare.emit('createasset', {
        context: c.testContext,
        options: {
          path: '/uploadassetchunk_remote.jpg',
          file: '/uploadassetchunk.jpg',
          fromOffset:  1024 * 1024,
          onChunk: function (nextOffset, totalSize, callback) {
            expect(nextOffset).toEqual(2 * 1024 * 1024);
            expect(totalSize).toEqual(10 * 1024 * 1024);
            callback(true);
          }
        }, callback: function (err) {
          expect(err).toBeFalsy();
          done();
        }
      });
    });
  });

  it('testCreateAssetError', function (done) {
    var date = new Date().getTime();
    c.fs.createEntityWithDatesSync('/uploadassetchunkerror.jpg', false, '12345', date, date);
    c.registerCreateAssetUrl(function (options, callback) {
      callback('there was an error!');
    });
    var start = false;
    var error = false;
    c.testShare.on('shareEvent', function (event) {
      if (event.event === 'syncfilestart') {
        start = true;
        expect(event.data.file).toEqual('/uploadassetchunkerror.jpg');
      } else if (event.event === 'syncfileerr') {
        error = true;
        expect(event.data.file).toEqual('/uploadassetchunkerror.jpg');
      }
    });
    c.testShare.emit('createasset', {
      context: c.testContext,
      options: {
        path: '/uploadassetchunkerror_remote.jpg',
        file: '/uploadassetchunkerror.jpg'
      }, callback: function (err) {
        expect(err).toBeTruthy();
        expect(start).toBeTruthy();
        expect(error).toBeTruthy();
        done();
      }
    })
  });

  it('testCreateAssetRetry', function (done) {
    var date = new Date().getTime();
    var events = {};
    c.fs.createEntityWithDatesSync('/uploadassetretry.jpg', false, '12345', date, date);
    c.registerCreateAssetUrl(function (options, callback) {
      c.unregisterCreateAssetUrl();
      callback('there was an error!');
    });
    c.testShare.on('shareEvent', function (event) {
      if (!events[event.event]) {
        events[event.event] = 0;
      }
      events[event.event]++;
    });

    c.testShare.emit('createasset', {
      context: c.testContext,
      options: {
        path: '/uploadassetretry_remote.jpg',
        file: '/uploadassetretry.jpg'
      }, callback: function (err) {
        expect(err).toBeFalsy();
        expect(events['syncfilestart']).toEqual(1);
        expect(events['syncfileend']).toEqual(1);
        expect(events['syncfileerr']).toBeFalsy();
        done();
      }
    });
  });

  it('testCreateAssetRetriesExceeded', function (done) {
    var date = new Date().getTime();
    var events = {};
    c.fs.createEntityWithDatesSync('/uploadassetretryexceeded.jpg', false, '12345', date, date);
    c.registerCreateAssetUrl(function (options, callback) {
      callback('there was an error!');
    });
    c.testShare.on('shareEvent', function (event) {
      if (!events[event.event]) {
        events[event.event] = 0;
      }
      events[event.event]++;
    });

    c.testShare.emit('createasset', {
      context: c.testContext,
      options: {
        path: '/uploadassetretryexceeded_remote.jpg',
        file: '/uploadassetretryexceeded.jpg'
      }, callback: function (err) {
        expect(err).toBeTruthy();
        expect(events['syncfilestart']).toEqual(1);
        expect(events['syncfileend']).toBeFalsy();
        expect(events['syncfileerr']).toEqual(1);
        done();
      }
    });
  });

  it('testCreateAssetPauseRetry', function (done) {
    var date = new Date().getTime();
    var events = {};
    c.fs.createEntityWithDatesSync('/uploadassetpauseretry.jpg', false, '12345', date, date);
    c.registerCreateAssetUrl(function (options, callback) {
      callback('there was an error!');
    });
    c.testShare.on('shareEvent', function (event) {
      if (!events[event.event]) {
        events[event.event] = 0;
      }
      events[event.event]++;
    });

    c.testShare.emit('createasset', {
      context: c.testContext,
      options: {
        path: '/uploadassetpauseretry_remote.jpg',
        file: '/uploadassetpauseretry.jpg',
        onChunk: function (nextOffset, totalSize, callback) {
          expect(nextOffset).toEqual(0);
          callback(true);
        }
      }, callback: function (err) {
        expect(err).toBeFalsy();
        expect(events['syncfilestart']).toEqual(1);
        expect(events['syncfileend']).toEqual(1);
        expect(events['syncfileerr']).toBeFalsy();
        done();
      }
    });
  });
});
