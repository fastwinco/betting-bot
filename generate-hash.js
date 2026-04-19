const bcrypt = require('bcryptjs');

const password = 'Runa2126#';
const hash = bcrypt.hashSync(password, 10);
console.log('Hash:', hash);
