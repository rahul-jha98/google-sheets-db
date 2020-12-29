import axios, {AxiosInstance, AxiosRequestConfig} from 'axios';
import {JWT} from 'google-auth-library';
import ACTIONS from './actions';
import {Sheet} from './ResponseStructure';
import Table from './Table';

const AUTH_MODE = {
  ACCESS_TOKEN: 1,
  API_KEY: 2,
  CREDENTIALS: 3
}

const GOOGLE_AUTH_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',

  // the list from the sheets v4 auth for spreadsheets.get
  // 'https://www.googleapis.com/auth/drive',
  // 'https://www.googleapis.com/auth/drive.readonly',
  // 'https://www.googleapis.com/auth/drive.file',
  // 'https://www.googleapis.com/auth/spreadsheets',
  // 'https://www.googleapis.com/auth/spreadsheets.readonly',
];

class Database {
  sheetId: string;

  _tables: Record<number, Table> = {};
  axios: AxiosInstance;

  authMode?: number;
  apiKey?: string;
  accessToken?: string;
  creds?: Object;
  jwtClient?: JWT;
  notifyAction: (actionType: number, ...params: string[]) => void = () => {};

  constructor(sheetId: string = '') {
    this.sheetId = sheetId;
    this.axios = axios.create({
      baseURL: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,

      paramsSerializer(params) {
        let options = '';

        Object.keys(params).forEach((key: string) => {
          const isParamTypeObject = typeof params[key] === 'object';

          const isParamTypeArray = isParamTypeObject && params[key].length >= 0;

          if (!isParamTypeObject) {
            options += `${key}=${encodeURIComponent(params[key])}&`;
          }

          if (isParamTypeObject && isParamTypeArray) {
            params[key].forEach((val: string) => {
              options += `${key}=${encodeURIComponent(val)}&`;
            });
          }
        });
        return options ? options.slice(0, -1) : options;
      },
    });
    this.axios.interceptors.request.use(this._setAuthorizationInRequest.bind(this));
  }

  subscrible(
    onActionCallback: (actionType: number, ...params: string[]) => void
  ) {
    this.notifyAction = onActionCallback;
  }

  _updateOrCreateTable({properties, data}: Sheet) {
    const {sheetId} = properties;
    if (!this._tables[sheetId]) {
      this._tables[sheetId] = new Table(this, {properties, data});
    } else {
      this._tables[sheetId]._properties = properties;
      this._tables[sheetId]._fillTableData(data);
    }
  }

  async loadData() {
    const response = await this.axios.get('/', {
      params: {
        includeGridData: true,
      },
    });
    response.data.sheets.forEach((s: Sheet) => {
      this._updateOrCreateTable(s);
    });
  }

  useApiKey(key: string) {
    this.authMode = AUTH_MODE.API_KEY;
    this.apiKey = key;
  }

  useAccessToken(token: string) {
    this.authMode = AUTH_MODE.ACCESS_TOKEN;
    this.accessToken = token;
  }

  async useServiceAccountAuth(
    client_email: string,
    private_key: string,
    impersonateAs?: string
  ) {
    this.jwtClient = new JWT({
      email: client_email,
      key: private_key,
      scopes: GOOGLE_AUTH_SCOPES,
      subject: impersonateAs,
    });
    await this.renewJwtAuth();
  }

  async renewJwtAuth() {
    this.authMode = AUTH_MODE.CREDENTIALS;
    await this.jwtClient?.authorize();
  }


  async _setAuthorizationInRequest(
    config: AxiosRequestConfig
  ): Promise<AxiosRequestConfig> {
    if (this.authMode === AUTH_MODE.ACCESS_TOKEN) {
      if (!this.accessToken) throw new Error('Access Token not provided');
      config.headers.Authorization = `Bearer ${this.accessToken}`;
    } else if (this.authMode === AUTH_MODE.API_KEY) {
      if (!this.apiKey) throw new Error('Please set API key');
      config.params = config.params || {};
      config.params.key = this.apiKey;
    } else if (this.authMode === AUTH_MODE.CREDENTIALS) {
      if (!this.jwtClient) throw new Error('JWT auth is not set up properly');
      // this seems to do the right thing and only renew the token if expired
      await this.jwtClient.authorize();

      config.headers.Authorization = `Bearer ${this.jwtClient.credentials.access_token}`;
    }
    return config;
  }
}

export default Database;