import os, sys
import zipfile, tempfile
import urllib.request


COMPONENT_URL = 'https://github.com/nielsfaber/scheduler-component/releases/download/v3.2.15/scheduler.zip'
CARD_URL = 'https://github.com/nielsfaber/scheduler-card/releases/download/v3.2.10/scheduler-card.js'

COMPONENT_DIRECTORY = tempfile.gettempdir() + '/scheduler-custom-component'
CARD_FILE = tempfile.gettempdir() + '/scheduler-custom-card.js'

if not os.path.exists(COMPONENT_DIRECTORY):
    print('Downloading', COMPONENT_URL, file=sys.stderr)
    filehandle, _ = urllib.request.urlretrieve(COMPONENT_URL)
    with zipfile.ZipFile(filehandle, 'r') as zip_ref:
        zip_ref.extractall(COMPONENT_DIRECTORY)
    urllib.request.urlcleanup()

if not os.path.exists(CARD_FILE):
    print('Downloading', CARD_URL, file=sys.stderr)
    urllib.request.urlretrieve(CARD_URL, CARD_FILE)

print(COMPONENT_DIRECTORY, CARD_FILE)
