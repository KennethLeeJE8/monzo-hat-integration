# monzo-hat-integration
Connecting information from Monzo to HAT PDAs

# Setup

Use npm install to install the neccessary packages

Use npm start to start the React Application

## .env file
Duplicate the .env.example file and name the duplicate .env, changing the following variables accordingly:

grant_type: Keep as authorization_code

client_id: Get from Monzo application on https://developers.monzo.com/api

client_secret: Get from Monzo application on https://developers.monzo.com/api

redirect_url: Application URL, make sure that it is a valid URL

Since I am testing it in a dev environment, I used [tolocalhost](https://tolocalhost.com/) as a valid URL as localhost does not work with OAuth. 

If you will be using localhost as well, then have your localhost running and fill out the corresponding port number at [tolocalhost](https://tolocalhost.com/). 

# Button Progression
Login -> MonzoAuthToken -> Monzo Account Balance

# Dual Authentication
There are 2 authentication steps in the process of grabbing yor account details:
- Email Verification

During the authentication process, it will ask for your email and send you an email with a link. Ensure that the email you use is registered with Monzo and that you access the link on the SAME DEVICE, as it uses cookies to ensure that the request and authentication is done on the same device. 

- Allow Data Access on Monzo Mobile Application

After getting your Auth Token, navigate to your Monzo mobile application. 

Ensure that you are logged in with the email that you gave in the previous authentication. 

There will be a pop-up on your screen, asking for permission to access your Monzo data, you just need to allow data access in order to grab account details

