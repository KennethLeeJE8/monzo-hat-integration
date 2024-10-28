import React, { useState, useEffect } from "react";
import "jquery-csv";
import axios from 'axios';
import Papa from 'papaparse';

function App() {
  const [ accessToken, setAccessToken] = useState("");
  const [ monzoAccount, setMonzoAccount] = useState([]);
  const queryString = window.location.search
  const urlParams = new URLSearchParams(queryString);
  const redirect_url = encodeURIComponent(process.env.REACT_APP_REDIRECT_URL)
  let csv = require('jquery-csv');

  async function launchAuth() {
    console.log (redirect_url)
    window.location.href = `https://auth.monzo.com/?redirect_uri=${redirect_url}&client_id=${process.env.REACT_APP_CLIENT_ID}&response_type=code&intent=login`
  }

async function getMonzoAuthToken() {
  const code = urlParams.get('code')
  console.log(window.location.href)
  console.log(code)
  const monzobody = new URLSearchParams();
  monzobody.append('grant_type', process.env.REACT_APP_GRANT_TYPE);
  monzobody.append('client_id', process.env.REACT_APP_CLIENT_ID);
  monzobody.append('client_secret', process.env.REACT_APP_CLIENT_SECRET);
  monzobody.append('redirect_uri', process.env.REACT_APP_REDIRECT_URL);
  monzobody.append('code', code);
  const response = await fetch(`https://api.monzo.com/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: monzobody
  });
  const data = await response.json();
  console.log(data); // Handle the response as needed
  setAccessToken(data.access_token)
}

async function getAccountBalance() {
  const response = await fetch(`https://api.monzo.com/accounts`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const data = await response.json();
  console.log(data); // Handle the response as needed
  setMonzoAccount(data.accounts)
}

    return (
        <div>
            <button onClick={ launchAuth }>Login</button>
            <button onClick={ getMonzoAuthToken }>MonzoAuthToken</button>
            <button onClick={ getAccountBalance }>Monzo Account Balance</button>
            <h2>text:</h2>
            <h2>{accessToken}</h2>
            {monzoAccount.map((item,i) => (
              <tr key = {i}>
                <td>{i}</td>
                <td>{item.description}</td>
                <td>{item.owners[0].preferred_name}</td>
                <td>{item.legal_entity}</td>
                <td>{item.owner_type}</td>
                <td>{item.currency}</td>
              </tr>
            ))}
        </div>
    );
}
export default App;