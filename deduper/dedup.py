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

"""Dedupes identical files in Google Drive."""

import os
from collections import defaultdict
from apiclient import discovery
from apiclient.http import BatchHttpRequest
from httplib2 import Http
from oauth2client.client import flow_from_clientsecrets
from oauth2client.file import Storage
from oauth2client import tools

ONE_GIG = float(1073741824) # so we can do non-integer arithmetic

def auth(http):
  """Authorize an http client, asking the user if required.

  Args:
    http: an httplib2.Http instance to authorize.
  """
  storage = Storage(os.path.expanduser('~/.drive-deduper.dat'))
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
  """Fetches all the files.

  Args:
    client: Authorized drive api client.
  Returns:
  """
  results = []
  page = ended = None
  while not ended:
    resp = client.files().list(pageToken=page, maxResults=100,
        q='trashed=false',
        fields='nextPageToken,items(id,md5Checksum,title,alternateLink,quotaBytesUsed)'
        ).execute()
    page = resp.get('nextPageToken')
    ended = page == None
    for item in resp['items']:
      if 'md5Checksum' in item:
        results.append(item)
    print 'Fetched: {}'.format(len(results))
  return results


def find_dupes(files):
  """Find the duplicates."""
  index = defaultdict(list)
  dupes = []
  for f in files:
    index[f['md5Checksum']].append(f)
  for k, v in index.items():
    if len(v) > 1:
      dupes.append(v)
  return dupes


def main():
  """Main entrypoint."""
  client = create_client()
  files = fetch_all_metadata(client)
  dupes = find_dupes(files)
  print '{} duplicates found. '.format(len(dupes))
  if len(dupes) == 0:
    print 'We are done.'
    return
  print 'Please check them.'
  total = 0
  for dupeset in dupes:
    print '--'
    for dupe in dupeset:
      print dupe['alternateLink'], dupe['title']
    for dupe in dupeset[1:]:
      total += int(dupe['quotaBytesUsed'])
  print '--'
  print '{} Gigabytes wasted.'.format(total / ONE_GIG)
  conf = raw_input('Great. Now trash the extras? (y/n) ')
  if conf.strip() == 'y':
    print 'Trashing.'
    batch = BatchHttpRequest()
    for dupeset in dupes:
      for dupe in dupeset[1:]:
        batch.add(client.files().trash(fileId=dupe['id']))
        if len(batch._order) == 1000: # batch maxes out at 1k
          batch.execute()
          batch = BatchHttpRequest()
    batch.execute()
    print 'We are done. Check the trash for your files.'
  else:
    print 'Not touching anything.'


if __name__ == '__main__':
  main()
