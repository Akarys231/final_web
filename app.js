const express = require("express");
const bodyParser = require("body-parser");
const session = require('express-session');
const request = require('request');
const axios = require('axios');
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const ejs = require('ejs');
const User = require('./models/User');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const NewsAPI = require('newsapi');
const newsapi = new NewsAPI('f1f361f711b0468fb111ec8c5da80d3f');

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/public'));


app.use(session({
    secret: '123',
    resave: false,
    saveUninitialized: true
}));
app.set('view engine', 'ejs');

const dbUrl = "mongodb+srv://akarys:3872fsFf@cluster0.0exorsi.mongodb.net/akarys";
const connectionParams = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
};


mongoose.connect(dbUrl, connectionParams)
    .then(() => console.info("Connected to the database"))
    .catch((e) => console.log("Error connecting to the database", e));

app.get("/", function (req, res) {
    res.render("index", { userIsLoggedIn: req.session.user });
});

app.get('/matches', async (req, res) => {
    try {
        const { league } = req.query;

        const response = await axios.get('https://api.football-data.org/v4/matches', {
            headers: {
                'X-Auth-Token': 'e7b233cdcfed4712b4bd38aa98e57508'
            },
            params: {
                status: 'FINISHED',
                limit: 5,
                competitions: league,
                dateTo: new Date().toISOString().split('T')[0],
                dateFrom: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0]
            }
        });

        const matches = response.data.matches;
        res.render('matches', { matches });
    } catch (error) {
        console.error(error);
        res.status(500).send('Something went wrong');
    }
});

app.get("/home", async function (req, res) {
    try {
        const response = await newsapi.v2.everything({
            q: 'football',
            language: 'en',
            sortBy: 'publishedAt'
        });

        const articles = response.articles;
        res.render("main", { articles });
    } catch (error) {
        console.error("Error fetching news:", error);
        res.render("main", { articles: [] });
    }
});

app.get('/teams', async (req, res) => {
    const teamName = req.query.teamName;
    const apiToken = 'e7b233cdcfed4712b4bd38aa98e57508';

    try {
        const response = await axios.get(`https://api.football-data.org/v4/teams`, {
            params: {
                name: teamName
            },
            headers: {
                'X-Auth-Token': apiToken
            }
        });

        const teams = response.data.teams;

        if (req.session.user) {
            const user = await User.findById(req.session.user._id);
            if (user) {
                user.searchHistory.push(req.query.teamShortName);
                await user.save();
            } else {
                console.error('User not found in session:', req.session.user);
            }
        }

        const searchHistory = req.session.user ? req.session.user.searchHistory : [];
        res.render('teams', { teams, searchHistory });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching team information');
    }
});


app.post('/players', async (req, res) => {
    const playerName = req.body.playerName;

    try {
        const playersResponse = await axios.get('https://www.football-data.org/v4/players/', {
            headers: {
                'X-Auth-Token': 'e7b233cdcfed4712b4bd38aa98e57508'
            },
            params: {
                search: playerName
            }
        });

        if (playersResponse.data.count === 0) {
            return res.render('players', { player: null, error: 'Player not found' });
        }

        const playerId = playersResponse.data.players[0].id;

        const playerResponse = await axios.get(`http://api.football-data.org/v4/persons/${playerId}`, {
            headers: {
                'X-Auth-Token': 'e7b233cdcfed4712b4bd38aa98e57508'
            }
        });

        const player = playerResponse.data;
        res.render('players', { player, error: null });
    } catch (error) {
        console.error('Error:', error);
        res.render('players', { player: null, error: 'Failed to fetch player data' });
    }
});



app.get('/players', (req, res) => {
    res.render('players', { player: null });
});

app.get("/home", function (req, res) {
    res.render("main", { error: null });
});

app.get("/login", function (req, res) {
    res.render("login", { error: null });
});

app.post("/login", async function (req, res) {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });

        if (user && !user.deletedAt && (await bcrypt.compare(password, user.password))) {
            req.session.user = { username: user.username, searchHistory: user.searchHistory, isAdmin: user.isAdmin };

            if (user.isAdmin) {
                res.redirect("/admin");
            } else {
                res.redirect("/home"); 
            }
        } else {
            res.render("login", { error: "Invalid username or password" });
        }
    } catch (error) {
        console.error("Error during login:", error);
        res.render("login", { error: "An error occurred. Please try again." });
    }
});


app.get("/register", function (req, res) {
    res.render("register", { error: null });
});

app.post("/register", async function (req, res) {
    const { username, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, searchHistory: [] });
        await newUser.save();
        req.session.user = { username: newUser.username, searchHistory: newUser.searchHistory };
        res.redirect("/home");
    } catch (error) {
        console.error("Error during registration:", error);
        res.render("register", { error: "An error occurred. Please try again." });
    }
});


app.get("/admin", async function (req, res) {
    try {
        const users = await User.find({});
        res.render("admin", { users });
    } catch (error) {
        console.error("Error fetching users:", error);
        res.send("An error occurred while fetching user data.");
    }
});


app.get("/admin/add", function (req, res) {
    res.render("addUser");
});


app.post("/admin/add", async function (req, res) {
    const { username, password, isAdmin } = req.body;

    try {
        const isAdminValue = isAdmin === 'true';

        const newUser = new User({
            username,
            password, 
            isAdmin: isAdminValue,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        await newUser.save();

        res.redirect("/admin");
    } catch (error) {
        console.error("Error adding user:", error);
        res.send("An error occurred while adding user.");
    }
});


app.post("/admin/edit/:userId", async function (req, res) {
    const userId = req.params.userId;
    const { username, newPassword, isAdmin } = req.body;

    try {
        const updateObject = {
            username,
            updatedAt: Date.now(),
            isAdmin: isAdmin === 'true',
        };

        if (newPassword) {
            updateObject.password = await bcrypt.hash(newPassword, 10);
        }

        await User.findByIdAndUpdate(userId, updateObject);

        res.redirect("/admin");
    } catch (error) {
        console.error("Error updating user:", error);
        res.send("An error occurred while updating user.");
    }
});



app.get("/admin/edit/:userId", async function (req, res) {
    const userId = req.params.userId;

    try {
        const user = await User.findById(userId);
        res.render("editUser", { user });
    } catch (error) {
        console.error("Error fetching user for edit:", error);
        res.send("An error occurred while fetching user data for edit.");
    }
});


app.post("/admin/delete/:userId", async function (req, res) {
    const userId = req.params.userId;

    try {
        await User.findByIdAndDelete(userId);

        res.redirect("/admin"); 
    } catch (error) {
        console.error("Error when deleting a user:", error);
        res.send("An error occurred while deleting the user.");
    }
});


app.get("/logout", function (req, res) {
    req.session.destroy();
    res.redirect("/");
});

 
app.listen(3000, function () {
    console.log("Server is running on port 3000");
});
