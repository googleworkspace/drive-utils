/**
 * Helper for implementing retries with backoff. Initial retry
 * delay is 1 second, increasing by 2x (+jitter) for subsequent retries
 * 
 * @constructor
 */
var RetryHandler = function() {
  this.interval = 1000; // Start at one second
  this.maxInterval = 60 * 1000; // Don't wait longer than a minute 
};

/**
 * Invoke the function after waiting 
 *
 * @param {function} fn Function to invoke
 */
RetryHandler.prototype.retry = function(fn) {
  setTimeout(fn, this.interval);
  this.interval = this.nextInterval();
};

/**
 * Calculate the next wait time.
 * @return {number} Next wait interval, in milliseconds
 *
 * @private
 */
RetryHandler.prototype.nextInterval = function() {
  var interval = this.interval * 2 + this.getRandomInt(0, 1000);
  return Math.min(interval, this.maxInterval);
};

/**
 * Get a random int in the range of min to max. Used to add jitter to wait times.
 *
 * @param {number} min Lower bounds
 * @param {number} max Upper bounds
 * @private
 */
RetryHandler.prototype.getRandomInt = function(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

/**
 * Helper class for resumable uploads using XHR/CORS. Can upload any Blob-like item, whether
 * files or in-memory constructs.
 *
 * @example
 * var content = new Blob(["Hello world"], {"type": "text/plain"});
 * var uploader = new MediaUploader({
 *   file: content,
 *   token: accessToken,
 *   onComplete: function(data) { ... }
 *   onError: function(data) { ... }
 * });
 * uploader.upload();
 *
 * @constructor
 * @param {object} options Hash of options
 * @param {string} options.token Access token
 * @param {blob} options.file Blob-like item to upload
 * @param {string} [options.fileId] ID of file if replacing
 * @param {object} [options.params] Additional query parameters
 * @param {string} [options.contentType] Content-type, if overriding the type of the blob.
 * @param {object} [options.metadata] File metadata
 * @param {function} [options.onComplete] Callback for when upload is complete
 * @param {function} [options.onError] Callback if upload fails
 */
var MediaUploader = function(options) {
  this.file = options.file;
  this.contentType = options.contentType || this.file.type || 'application/octet-stream';
  this.metadata = options.metadata || {
    'title': this.file.name,
    'mimeType': this.contentType
  };
  this.token = options.token;
  this.onComplete = options.onComplete;
  this.onError = options.onError;
  this.offset = options.offset || 0;
  this.chunkSize = options.chunkSize || 0;
  this.retryHandler = new RetryHandler();

  this.uploadType = 'resumable';

  this.url = options.url;
  if (!this.url) {
    var params = options.params || {};
    params['uploadType'] = this.uploadType;
    this.url = this.buildUrl(options.fileId, params);
  }
  this.httpMethod = this.fileId ? 'PUT' : 'POST';
};

/**
 * Initiate the upload.
 */ 
MediaUploader.prototype.upload = function() {
  var self = this;
  var xhr = new XMLHttpRequest();

  xhr.open(this.httpMethod, this.url, true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('X-Upload-Content-Length', this.file.size);
  xhr.setRequestHeader('X-Upload-Content-Type', this.contentType);

  xhr.onload = function(e) {
    var location = e.target.getResponseHeader('Location');
    this.url = location;
    this.sendFile();
  }.bind(this);
  xhr.onerror = this.onUploadError.bind(this);
  xhr.send(JSON.stringify(this.metadata));
};

/**
 * Send the actual file content.
 *
 * @private
 */ 
MediaUploader.prototype.sendFile = function() {
  var content = this.file;
  var end = this.file.size;
  
  if (this.offset || this.chunkSize) {
    // Only bother to slice the file if we're either resuming or uploading in chunks
    if (this.chunkSize) {
      end = Math.min(this.offset + this.chunkSize, this.file.size);
    }
    content = content.slice(this.offset, end);
  }
  
  var xhr = new XMLHttpRequest();
  xhr.open('PUT', this.url, true);
  xhr.setRequestHeader('Content-Type', this.contentType);
  xhr.setRequestHeader('Content-Range', "bytes " + this.offset + "-" + (end - 1) + "/" + this.file.size);
  xhr.setRequestHeader('X-Upload-Content-Type', this.file.type);
  xhr.onload = this.onResumableUploadSuccess.bind(this);
  xhr.onerror = this.onResumableUploadError.bind(this);
  xhr.send(content);
};

/**
 * Query for the state of the file for resumption.
 * 
 * @private
 */ 
MediaUploader.prototype.resume = function() {
  var xhr = new XMLHttpRequest();
  xhr.open('PUT', this.url, true);
  xhr.setRequestHeader('Content-Range', "bytes */" + this.file.size);
  xhr.setRequestHeader('X-Upload-Content-Type', this.file.type);
  xhr.onload = this.onResumableUploadSuccess.bind(this);
  xhr.onerror = this.onResumableUploadError.bind(this);
  xhr.send();
};

/**
 * Handle successful responses for uploads. Depending on the context,
 * may continue with uploading the next chunk of the file or, if complete,
 * invokes the caller's callback.
 *
 * @private
 * @param {object} e XHR event
 */
MediaUploader.prototype.onResumableUploadSuccess = function(e) {
  var response = e.target;
  if (e.target.status == 200 || e.target.status == 201) {
    this.onComplete(e.target.response);
  } else if (e.target.status == 308) {
    var range = e.target.getResponseHeader('Range');
    if (range) {
      this.offset = parseInt(range.match(/\d+/g).pop()) + 1
    }
    this.sendFile();
  }
};

/**
 * Handles errors for uploads. Either retries or aborts depending
 * on the error.
 *
 * @private
 * @param {object} e XHR event
 */
MediaUploader.prototype.onResumableUploadError = function(e) {
  if (e.target.status == 401 || e.target.status == 404) {
    this.onError(e.target.response);
  } else {
    this.retryHandler.retry(this.resume.bind(this));
  }
};

/**
 * Upload complete, invoke callback.
 *
 * @private
 * @param {object} e XHR event
 */
MediaUploader.prototype.onUploadSuccess = function(e) {
  this.onComplete(e.target.response);
};

/**
 * Upload failed, invoke callback.
 *
 * @private
 * @param {object} e XHR event
 */
MediaUploader.prototype.onUploadError = function(e) {
  thiss.onError(e.target.response);
};

/**
* Construct a query string from a hash/object
*
* @private
* @param {object} [params] Key/value pairs for query string
* @return {string} query string
*/
MediaUploader.prototype.buildQuery = function(params) {
  params = params || {};
  return Object.getOwnPropertyNames(params).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
};

/**
* Build the drive upload URL
*
* @private
* @param {string} [id] File ID if replacing
* @param {object} [params] Query parameters
* @return {string} URL
*/
MediaUploader.prototype.buildUrl = function(id, params) {
  var url = 'https://www.googleapis.com/upload/drive/v2/files/{id}';
  url = url.replace(/\{id\}/, id ? id : '');
  var query = this.buildQuery(params);
  if (query && query.length > 0) {
    url += '?' + query;
  }
  return url;
};



