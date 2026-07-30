'use strict';

/**
 * moparDocService.js — Chiamate downstream verso i due gateway MoparDoc:
 *  - job-docs connector (api-oidc-preprod.groupe-psa.com): CreateJobCard, CreateAccessToken
 *  - MoparDocs Browser API (lab-examaftersales.fiat.com): getUploadDocURL, UploadedDoc
 *
 * Tutte e quattro le chiamate condividono lo stesso ****** PingFederate
 * (authService.getBearerToken) e le stesse credenziali IBM API Connect
 * (X-IBM-Client-Id / X-IBM-Client-Secret), ma usano host diversi.
 */

const { URL } = require('url');
const { httpsRequest } = require('./httpClient');
const { getBearerToken } = require('./authService');
const config = require('./config');

/**
 * Costruisce le options per una richiesta POST JSON verso uno dei due gateway.
 * @param {{baseUrl: string, basePath: string, ibmClientId: string, ibmClientSecret: string}} target
 * @param {string} resourcePath - es. "/CreateJobCard"
 * @param {string} bearerToken
 * @param {string} bodyStr
 */
function buildOptions(target, resourcePath, bearerToken, bodyStr) {
  const endpoint = new URL(target.baseUrl);
  return {
    hostname: endpoint.hostname,
    port: endpoint.port || 443,
    path: `${target.basePath}${resourcePath}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      Authorization: `Bearer ${bearerToken}`,
      'X-IBM-Client-Id': target.ibmClientId,
      'X-IBM-Client-Secret': target.ibmClientSecret,
    },
  };
}

async function postJson(target, resourcePath, payload) {
  const bearerToken = await getBearerToken();
  const bodyStr = JSON.stringify(payload);
  const options = buildOptions(target, resourcePath, bearerToken, bodyStr);

  console.log(`[moparDocService] POST ${target.baseUrl}${options.path}`);
  const response = await httpsRequest(options, bodyStr);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `[moparDocService] ${resourcePath} failed: HTTP ${response.statusCode} - ${JSON.stringify(response.body)}`
    );
  }

  return response.body;
}

/**
 * CreateJobCard — crea una job card sul connector job-docs (PSA).
 * @param {{vin: string, market: string, source: string, UserName: string, dealerCode: string, JobCard_Title: string, TAMAccessCode: string}} params
 */
async function createJobCard(params) {
  const required = ['vin', 'market', 'source', 'UserName', 'dealerCode', 'JobCard_Title', 'TAMAccessCode'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[createJobCard] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    vin: params.vin,
    market: params.market,
    source: params.source,
    UserName: params.UserName,
    dealerCode: params.dealerCode,
    JobCard_Title: params.JobCard_Title,
    TAMAccessCode: params.TAMAccessCode,
  };

  return postJson(config.jobDocs, '/CreateJobCard', payload);
}

/**
 * CreateAccessToken — ottiene un APIAccessCode/AccessToken per una job card
 * già creata (necessario per autenticare getUploadDocURL/uploadedDoc verso
 * MoparDocs Browser API). Stesso connector job-docs (PSA) di createJobCard.
 * @param {{JobCardId: string, UserName: string, dealerCode: string, market: string, APIAccessCode: string}} params
 */
async function createAccessToken(params) {
  const required = ['JobCardId', 'UserName', 'dealerCode', 'market', 'APIAccessCode'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[createAccessToken] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    JobCardId: params.JobCardId,
    UserName: params.UserName,
    dealerCode: params.dealerCode,
    market: params.market,
    APIAccessCode: params.APIAccessCode,
  };

  return postJson(config.jobDocs, '/CreateAccessToken', payload);
}

/**
 * getUploadDocURL — ottiene la URL pre-firmata per l'upload di un documento.
 * @param {{JobCardId: string, Filename: string, ContentType: string, AccessToken: string, Filetype: string}} params
 */
async function getUploadDocURL(params) {
  const required = ['JobCardId', 'Filename', 'ContentType', 'AccessToken', 'Filetype'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[getUploadDocURL] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    JobCardId: params.JobCardId,
    Filename: params.Filename,
    ContentType: params.ContentType,
    AccessToken: params.AccessToken,
    Filetype: params.Filetype,
  };

  return postJson(config.moparDocsApi, '/getUploadDocURL', payload);
}

/**
 * UploadedDoc — notifica il completamento dell'upload di un documento.
 * @param {{JobCardId: string, DocumentId: string, Action: string, AccessToken: string}} params
 */
async function uploadedDoc(params) {
  const required = ['JobCardId', 'DocumentId', 'Action', 'AccessToken'];
  const missing = required.filter((k) => !params || !params[k]);
  if (missing.length > 0) {
    throw new Error(`[uploadedDoc] Missing required field(s): ${missing.join(', ')}`);
  }

  const payload = {
    JobCardId: params.JobCardId,
    DocumentId: params.DocumentId,
    Action: params.Action,
    AccessToken: params.AccessToken,
  };

  return postJson(config.moparDocsApi, '/UploadedDoc', payload);
}

module.exports = { createJobCard, createAccessToken, getUploadDocURL, uploadedDoc };
