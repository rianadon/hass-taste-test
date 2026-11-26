import os, sys
import zipfile, tempfile
import urllib.request


COMPONENT_VERSION = 'v3.3.9'
CARD_VERSION = 'v4.0.20'
COMPONENT_URL = f'https://github.com/nielsfaber/scheduler-component/releases/download/{COMPONENT_VERSION}/scheduler.zip'
CARD_URL = f'https://github.com/nielsfaber/scheduler-card/releases/download/{CARD_VERSION}/scheduler-card.js'

# Cache paths include the version so bumping a version downloads it fresh
# The component folder must be named after the integration's domain, so the version goes in its parent
COMPONENT_DIRECTORY = f'{tempfile.gettempdir()}/scheduler-component-{COMPONENT_VERSION}/scheduler'
CARD_FILE = f'{tempfile.gettempdir()}/scheduler-custom-card-{CARD_VERSION}.js'

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
