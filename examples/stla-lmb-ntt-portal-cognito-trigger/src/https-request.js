const https = require('https');
const { Agent } = require('https');


function makeHttpsRequest(url, pfxBuffer, passphrase) {
  return new Promise((resolve, reject) => {
    const agent = new Agent({ 
      pfx: pfxBuffer,
      passphrase,
      rejectUnauthorized: false 
    });
    
    https.get(url, { agent }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

module.exports = { makeHttpsRequest };