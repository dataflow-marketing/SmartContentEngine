import axios from 'axios';

/**
 * Sends an HTTP GET request.
 * @param {string} url - The URL to fetch.
 * @param {object} [config] - Optional Axios configuration.
 * @returns {Promise} - The Axios response.
 */
export async function get(url, config = {}) {
  return axios.get(url, config);
}

/**
 * Sends an HTTP POST request.
 * @param {string} url - The URL to post to.
 * @param {object} payload - The request payload.
 * @param {object} [config] - Optional Axios configuration.
 * @returns {Promise} - The Axios response.
 */
export async function post(url, payload, config = {}) {
  return axios.post(url, payload, config);
}
