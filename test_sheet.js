const axios = require('axios'); // ابتدا دستور npm install axios را بزن

const SPREADSHEET_ID = '1lhogjschT9dDW8yZhaSdmhSzvVVtQ7Ih8ijn-mcwt34';
const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;

async function checkSheet() {
    try {
        const response = await axios.get(url);
        console.log("محتوای شیت:");
        console.log(response.data);
    } catch (error) {
        console.error("خطا در خواندن شیت:", error);
    }
}

checkSheet();
