# Beekeeping Miner
Automatic compound every 12h bot  

[![BEEKEEPING MINER](http://img.youtube.com/vi/Cfu3KuBdzkk/0.jpg)](http://www.youtube.com/watch?v=Cfu3KuBdzkk "BEEKEEPING MINER")

**URL:** https://busd.bee-n-bee.io/?ref=0xFdD831b51DCdA2be256Edf12Cd81C6Af79b6D7Df 

## ENV Variables 
You will need to create a file called *.env* in the root directory, copy the text in *.env.example* and fill in the variables. 
If you want to use the emailer, then you will need [Google App Passwords](https://support.google.com/accounts/answer/185833?hl=en). 

## How to Run
You could run it on your desktop just using [Node.js](https://github.com/nodejs/node) in your terminal. However, on a production environment, it is recommended to use something like [PM2](https://github.com/Unitech/pm2) to run the processes to ensure robust uptime and management. 
```
npm install
pm2 start bee.js -n "BEE"
pm2 save

```
**Donate:** 0xFdD831b51DCdA2be256Edf12Cd81C6Af79b6D7Df
