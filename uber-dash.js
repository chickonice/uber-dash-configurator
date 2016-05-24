var AWS = require('aws-sdk');
var https = require('https');

const region = 'us-west-2';
const s3_endpoint = 's3-us-west-2.amazonaws.com';
const ses_endpoint = 'email.us-west-2.amazonaws.com';

var ses = new AWS.SES({apiVersion: '2010-12-01'});
const email = process.env.EMAIL;
var to = [email];
var from = email;

var s3 = new AWS.S3();
const s3_bucket = 'requestuber';
const s3_key = 'request-id';

const token = process.env.TOKEN;

const uberx_id = 'a1111c8c-c720-46c3-8534-2fcdd730040d'; // UberX SF
const uberblack_id = 'd4abaae7-f4d6-4152-91cc-77523e8165a4'; // UberBlack SF
const successfully_cancelled_uber_status_code = 204;
const successfully_requested_uber_status_code = 202;
const uber_surge_pricing_status_code = 409;

const start_latitude = 37.7749; // Lat SF
const start_longitude = -122.4194; // Long SF

const single_click = 'SINGLE';
const double_click = 'DOUBLE';
const long_click = 'LONG';

function callUber(event, context) { 
    if (event.clickType === single_click) {
        requestUber(event, context, uberx_id)
    }
    else if (event.clickType === double_click) {
        requestUber(event, context, uberblack_id)
    }
    else if (event.clickType === long_click) {
        cancelUber(event, context);
    }
    else {
        context.fail(event);
    }
}

function cancelUber(event, context) {
    AWS.config.update({
        'region': region,
        'endpoint': s3_endpoint
    });
    
    var params = {'Bucket': s3_bucket, 'Key': s3_key};
    s3.getObject(params, function(err, data) {
        if (err) console.log(err);
        else {
            var request_id = data.Body.toString();
            
            data = JSON.stringify(request_id);
            
            var headers = {
                'Authorization':  'Bearer ' + token,
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(data)
            };
        
            var options = {
                'host':    'api.uber.com',
                'path':    '/v1/requests/' + request_id,
                'method':  'DELETE',
                'headers': headers
            };
            
            var req = https.request(options, function(res) {
                var body = '';
                res.on('data', function (chunk) {
                    body += chunk;
                });
                
                res.on('end', function () {
                    // Successfully cancelled Uber
                    if (res.statusCode === successfully_cancelled_uber_status_code) {
                        console.log('Uber cancelled. Status code: ' + res.statusCode);
                    }
                    context.done();
                });
            });
            req.write(data);
            req.end();
        }
    });
}

function requestUber(event, context, product_id) {
    var data =  {
        'product_id': product_id,
        'start_latitude':  start_latitude,
        'start_longitude': start_longitude
    };
    
    data = JSON.stringify(data);

    var headers = {
        'Authorization':  'Bearer ' + token,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data)
    };

    var options = {
        'host':    'api.uber.com',
        'path':    '/v1/requests',
        'method':  'POST',
        'headers': headers
    };
    
    var req = https.request(options, function(res) {
        var body = '';
        res.on('data', function (chunk) {
            body += chunk;
        });
    
        res.on('end', function () {
            var parsed = JSON.parse(body);
          
            // Successfully requested Uber
            if (res.statusCode === successfully_requested_uber_status_code) {
                // Save request_id to S3 in case the user wants to cancel the Uber
                console.log('Uber requested. Status code: ' + res.statusCode);
                
                AWS.config.update({
                    'region': region,
                    'endpoint': s3_endpoint
                });
                
                var params = {'Bucket': s3_bucket, 'Key': s3_key, Body: parsed.request_id};
                s3.upload(params, function(err, data) {
                    if (err) console.log(err);
                    else console.log(data);

                    context.done();
                });
            }
            // Uber has surge pricing
            else if (res.statusCode === uber_surge_pricing_status_code) {
                // Send an email to confirm surge pricing
                console.log('Surge pricing. Status code: ' + res.statusCode);
                
                AWS.config.update({
                    'region': region,
                    'endpoint': ses_endpoint
                });
                
                var params = {
                        Destination: {
                            ToAddresses: to
                        },
                        Message: {
                            Body: {
                                Text: {
                                    Data: 'Click here to accept surge pricing: ' + parsed.meta.surge_confirmation.href
                                }
                            },
                            Subject: {
                                Data: 'Accept surge pricing'
                            }
                        },
                        Source: from
                    };
                
                ses.sendEmail(params, function(err, data) {
                    if (err) console.log(err);
                    else     console.log(data);
                    
                    context.done();
                });
            }
            else {
                console.log('Uber request failed. Status code: ' + res.statusCode);
                context.fail(event);
            }
        });
    });

    req.write(data);
    req.end();
}

exports.handler = callUber;
