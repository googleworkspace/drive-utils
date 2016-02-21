# Vimeo Upload

Helper code for uploading video files directly with vanilla Javascript (XHR/CORS) to your Vimeo account. 

Try the [live version](http://websemantics.github.io/vimeo-upload/)
and drag & drop files to upload them to Vimeo.

## Usage

If you'd like to use the code in your own project, copy `upload.js` and include it.

    <script src="/path/to/upload.js"></script>
    
When uploading a file, create a new MediaUploader initialized with a Blob or File and Vimeo access token. Then call `upload()` to start the upload process.

    var uploader = new MediaUploader({
      file: content,
      token: accessToken,
    });
    uploader.upload();

Your access token need to be authorized by Vimeo.

See `upload.js` for additional parameters you can include when initializing the uploader, including callbacks for success & failure events.

This code has only been tested for uploading videos and monitoring progress.

## ToDo

Implement Pause / Resume

## Open Source Projects Used

- [cors-upload-sample](https://github.com/googledrive/cors-upload-sample)

