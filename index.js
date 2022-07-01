const publicLinks = {};
const params = new URLSearchParams(window.location.search);
const config = {
  debug: params.get('debug') || false,
  origin: params.get('origin'),
  publicLink: params.get('publicLink') || false,
  publicLinkDuration: parseInt(params.get('publicLinkDuration'), 10) || 7,
  server: null,
  authority: null,
  clientId: null,
  accessToken: null,
};

const parseParams = async () => {
  if (!config.origin) {
    throw new Error('You must specify a origin query parameter');
  }

  config.origin = new URL(config.origin).origin;
  if (!config.origin.endsWith('cern.ch')) {
    const allowedOrigins = await getAllowedOrigins();
    if (!allowedOrigins.includes(config.origin)) {
      throw new Error('Invalid origin');
    }
  }
};

const getConfig = async () => {
  const configRes = await fetch('file-picker-config.json');
  const configData = await configRes.json();
  config.server = configData.server;
  config.authority = configData.openIdConnect.authority;
  config.clientId = configData.openIdConnect.client_id;
};

const getAllowedOrigins = async () => {
  const allowedOriginsRes = await fetch('allowed-origins.json');
  const allowedOrigins = await allowedOriginsRes.json();
  return allowedOrigins;
};

const checkAccessToken = async accessToken => {
  const accessCheckUrl = `${config.server}/remote.php/webdav/?access_token=${accessToken}`;
  try {
    await fetch(accessCheckUrl, { method: 'PROPFIND' });
    return true;
  } catch (e) {
    // right now cernbox causes a cors error when not authenticated, no way to check status
    console.log("Our access token does not seem to work, let's clean up");
    sessionStorage.clear();
    location.reload();
  }
};

const getAccessToken = async () => {
  const accessToken = JSON.parse(
    sessionStorage.getItem(`oc_oAuthuser:${config.authority}:${config.clientId}`)
  ).access_token;

  const valid = await checkAccessToken(accessToken);

  config.accessToken = valid ? accessToken : null;
};

const handleUpdateBasic = paths => {
  return paths.map(path => `${config.server}/remote.php/webdav${path}?access_token=${config.accessToken}`);
};

const generatePublicLink = async () => {
  const publicLinkRequestUrl = `${config.server}/ocs/v1.php/apps/files_sharing/api/v1/shares`;
  const expireDate = new Date();
  expireDate.setDate(expireDate.getDate() + config.publicLinkDuration);
  const data = new FormData();
  data.append('shareType', 3);
  data.append('path', path);
  data.append('permissions', 1);
  data.append('expireDate', expireDate.toISOString());

  const publicLinkRes = await fetch(publicLinkRequestUrl, {
    method: 'POST',
    body: data,
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  const publicLinkText = await publicLinkRes.text();
  const parser = new DOMParser();
  const publicLinkDocument = parser.parseFromString(publicLinkText, 'text/xml');
  const token = publicLinkDocument.querySelector('token').textContent;
  const fileName = path.split('/').pop();
  return `${config.server}/remote.php/dav/public-files/${token}/${fileName}`;
};

const handleUpdatePublicLink = async paths => {
  newPaths = paths.filter(path => !publicLinks[path]);
  for (path of newPaths) {
    publicLinks[path] = await generatePublicLink(path);
  }

  if (config.debug) console.info('Public link cache', publicLinks);

  return paths.map(path => publicLinks[path]);
};

(async () => {
  await parseParams();
  await getConfig();
  await getAccessToken();

  document.getElementById('file-picker').addEventListener('update', async event => {
    // Get the newest access token.
    await getAccessToken();

    const paths = event.detail[0].map(r => r.path);
    const files = config.publicLink ? await handleUpdatePublicLink(paths) : handleUpdateBasic(paths);

    if (config.debug) console.info('Sending message to parent:', { files }, config.origin);

    window.parent.postMessage({ files }, config.origin);
  });
})();
