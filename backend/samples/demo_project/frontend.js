// Intentionally flawed JavaScript file for CodePulse demo.
// DO NOT use as a template for real code!

const express = require('express');
const { exec } = require('child_process');

const app = express();

// eval usage — CP-JS-001
app.get('/calc', (req, res) => {
    const result = eval(req.query.expression);
    res.json({ result });
});

// innerHTML with user data — CP-JS-003
function renderUserProfile(user) {
    const container = document.getElementById('profile');
    container.innerHTML = '<h1>' + user.name + '</h1><p>' + user.bio + '</p>';
}

// document.write — CP-JS-005
function loadWidget(src) {
    document.write('<script src="' + src + '"></script>');
}

// child_process.exec with concatenation — CP-JS-006
function runCommand(userInput) {
    exec('ls -la ' + userInput, (err, stdout) => {
        console.log(stdout);
    });
}

// == instead of === — CP-JS-007
function checkValue(val) {
    if (val == null) {
        return false;
    }
    if (val == 0) {
        return false;
    }
    return true;
}

// Empty catch block — CP-JS-009
function parseData(input) {
    try {
        return JSON.parse(input);
    } catch (e) {}
}

// console.log left in — CP-JS-008
function processOrder(order) {
    console.log('Processing order:', order.id);
    return { status: 'processed', id: order.id };
}

// dangerouslySetInnerHTML
function RawContent({ html }) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
