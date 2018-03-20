# Copyright 2018 Google Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Sets dates on images to the EXIF dates."""

import os
from datetime import datetime
from apiclient import discovery
from apiclient.http import BatchHttpRequest
from httplib2 import Http
from oauth2client.client import flow_from_clientsecrets
from oauth2client.file import Storage
from oauth2client import tools

def auth(http):
  """Authorize an http client, asking the user if required.

  Args:
    http: an httplib2.Http instance to authorize.
  """
  storage = Storage(os.path.expanduser('~/.drive-datefix.dat'))
  credentials = storage.get()
  if credentials is None or credentials.invalid:
    flow = flow_from_clientsecrets(
        'client_secrets.json',
        scope='https://www.googleapis.com/auth/drive')
    flags = tools.argparser.parse_args(args=[])
    credentials = tools.run_flow(flow, storage, flags)
  credentials.authorize(http)


def create_client():
  """Creates an authorized Drive api client.

  Returns:
    Authorized drive client.
  """
  http = Http()
  auth(http)
  return discovery.build('drive', 'v2', http=http)


def fetch_all_metadata(client):
  """Fetches all the image files.

  Args:
    client: Authorized drive api client.
  Returns:
  """
  results = []
  page = ended = None
  while not ended:
    resp = client.files().list(pageToken=page, maxResults=100,
        q='trashed=false and mimeType="image/jpeg"',
        fields=('nextPageToken,items(id),items(imageMediaMetadata/date,'
                'modifiedDate,createdDate,modifiedByMeDate,alternateLink)')
        ).execute()
    page = resp.get('nextPageToken')
    ended = page == None
    results.extend(resp['items'])
    print 'Fetched: {}'.format(len(results))
  return results


def chunks(l, n):
  """Yield successive n-sized chunks from l."""
  for i in xrange(0, len(l), n):
    yield l[i:i+n]


def formatDate(date):
  """Formats a date correctly for the Drive API."""
  return date.isoformat('T') + '.0Z'


def parseDate(timestamp):
  """Parses an EXIF date."""
  return datetime.strptime(timestamp, '%Y:%m:%d %H:%M:%S')


def batch_patch_dates(client, files):
  """Update dates on files to match EXIF data."""
  for chunk in chunks(files, 100): # Should be 1000, but 500 is more reliable.
    batch = BatchHttpRequest()
    for fmeta in chunk:
      if not (fmeta.get('imageMediaMetadata') and
              fmeta.get('imageMediaMetadata').get('date')):
        continue
      try:
        real_date = parseDate(fmeta['imageMediaMetadata']['date'])
      except ValueError:
        continue
      pmeta = {
        'modifiedDate': formatDate(real_date),
      }
      if formatDate(real_date) == fmeta['modifiedDate']:
        continue
      req = client.files().patch(fileId=fmeta['id'], setModifiedDate=True, body=pmeta)
      batch.add(req)
    batch.execute()


def main():
  """Main entrypoint."""
  client = create_client()
  files = fetch_all_metadata(client)
  print 'Found: {} images.'.format(len(files))
  conf = raw_input('Great. Now fix the dates? (y/n) ')
  if conf.strip() == 'y':
    batch_patch_dates(client, files)
  print 'And we are done.'


if __name__ == '__main__':
  main()
