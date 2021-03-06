//Copyright 2012 Telefonica Investigación y Desarrollo, S.A.U
//
//This file is part of RUSH.
//
//  RUSH is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public
//  License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
//  version.
//  RUSH is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty
//  of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.
//
//  You should have received a copy of the GNU Affero General Public License along with RUSH
//  . If not, seehttp://www.gnu.org/licenses/.
//
//For those usages not covered by the GNU Affero General Public License please contact with::dtc_support@tid.es

var http = require('http');
var MG = require('./myGlobals').C;
var url = require('url');
var db = require('./dbRelayer');

var path = require('path');
var log = require('./logger');
var logger = log.newLogger();
logger.prefix = path.basename(module.filename, '.js');


function init(emitter) {
  'use strict';

  logger.debug('Initializing Callback Listener', { op: 'INIT EV CALLBACK', arguments: [ emitter ]});

  return function(callback) {
    emitter.on(MG.EVENT_NEWSTATE, function onNewEvent(data) {

      function getHttpCallback(cbState, cbErrField) {
        return function onHttpCb(error, result) {

          var traceID = data.task.traceID;

          if (error || result) {
            var st = {
              id: data.task.id,
              traceID: data.task.traceID,
              state: cbState, //MG.STATE_CALLBACK,
              date: new Date(),
              task: data.task,
              err: error,
              result: result
            };
            logger.info('Callback Ended', { userID: data.task.user, correlator: traceID, op: 'HTTP CALLBACK',
              callbackState: st, transid: data.task.id });
            emitter.emit(MG.EVENT_NEWSTATE, st);
          }

          if (error) {
            logger.warning('Callback Error', {  userID: data.task.user, correlator: traceID, op: 'HTTP CALLBACK',
              transid: data.task.id, error: error });
            var errev = {
              id: data.task.id,
              traceID: data.task.traceID,
              date: new Date()
            };
            errev[cbErrField] = error;
            emitter.emit(MG.EVENT_ERR, errev);
          }
        };
      }

      if (data.state === MG.STATE_ERROR || data.state === MG.STATE_COMPLETED) {
        doHttpCallback(data.task, data.result,
            data.task.headers[MG.HEAD_RELAYER_HTTPCALLBACK], 'callback',
            getHttpCallback(MG.STATE_CALLBACK, 'callback_err'));
      }
      if (data.state === MG.STATE_ERROR) {
        doHttpCallback(data.task, data.result,
            data.task.headers[MG.HEAD_RELAYER_HTTPCALLBACK_ERROR],
            'on_err_callback',
            getHttpCallback(MG.STATE_ONERR_CALLBACK, 'on_err_callback_err'));
      }
    });
    callback(null, 'ev_callback OK');
  };
}


function doHttpCallback(task, respObj, callbackHost, cbField, callback) {
  'use strict';
  var cbRes = {};
  var traceID = task.traceID;

  if (callbackHost) {
    var callbackOptions = url.parse(callbackHost);
    callbackOptions.method = 'POST';
    var callbackReq = http.request(callbackOptions, function(callbackRes) {
      //check callbackRes status (modify state) Not interested in body
      cbRes[cbField + '_status'] = callbackRes.statusCode;
      callbackRes.resume(); //Node 0.10 compatibility
      if (task.headers[MG.HEAD_RELAYER_PERSISTENCE]) {
        db.update(task.id, cbRes, traceID, task.user, function onUpdated(err) {
          if (err) {
            logger.warning('Redis Error', { userID: task.user, correlator: traceID, op: 'HTTP CALLBACK',
              transid: task.id, error: err });
          }
          if (callback) {
            callback(err, cbRes);
          }
        });
      } else {
        if (callback) {
          callback(null, cbRes);
        }
      }
    });


    callbackReq.on('error', function onReqError(err) {
      //error in request
      if (err) {
        logger.warning('Request Error', { userID: task.user, correlator: traceID, op: 'HTTP CALLBACK',
          transid: task.id, error: err});
      }
      var cbSt = {};
      cbSt[cbField + '_err'] = err.message;

      //store iff persistence policy
      if (task.headers[MG.HEAD_RELAYER_PERSISTENCE]) {
        db.update(task.id, cbSt, traceID, task.user, function onUpdated(err) {
          if (err) {
            logger.warning('Redis Error', { userID: task.user, correlator: traceID,
              op: 'HTTP CALLBACK', transid: task.id, error: err });
          }
          if (callback) {
            callback(cbSt, null);
          }
        });
      } else {
        if (callback) {
          callback(cbSt, null);
        }
      }
    });
    var strRespObj = JSON.stringify(respObj);
    callbackReq.write(strRespObj);
    callbackReq.end();
  } else {
    if (callback) {
      callback(null);
    }
  }
}

exports.init = init;


//require('./hookLogger.js').init(exports, logger);
