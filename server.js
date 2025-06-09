require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');

const app = express();
app.use(cors());
app.use(express.json()); // Para recibir JSON en las peticiones

// Conectar con PostgreSQL
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false },
});

// Configurar AWS S3
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
  });
  
  // Configurar Multer para S3
  const upload = multer({
    storage: multerS3({
      s3: s3,
      bucket: process.env.S3_BUCKET_NAME,
      acl: 'public-read', // Permitir acceso público a las imágenes
      key: function (req, file, cb) {
        cb(null, `images/${Date.now()}-${file.originalname}`); // Nombre del archivo en S3
      }
    })
  });

    const queryPosts = `SELECT
                            P.*,
                            U.USER_PHOTO
                        FROM
                            FOLLOWERS F
                            JOIN USERS U ON F.FOLLOWED_ID = U.USER_ID  -- Relaciona followers con usuarios seguidos
                            JOIN POSTS P ON U.USERNAME = P.USER_NAME  -- Relaciona usuarios seguidos con sus posts
                        WHERE
                            F.FOLLOWER_ID = $1; `;

    const getPostsFetch1 = `SELECT
                                posts.*, users.user_photo FROM posts
                            JOIN
                                users
                            ON
                                posts.user_name = users.username
                            WHERE
                                hashtag && ARRAY[$1]`;

    const getPostsFetch2 = `SELECT
                                posts.*, users.user_photo FROM posts
                            JOIN
                                users
                            ON
                                posts.user_name = users.username
                            WHERE
                                title LIKE '%' || $1 || '%'`;

    const getPostsFetch3 = `SELECT
                                posts.*, users.user_photo FROM posts
                            JOIN
                                users
                            ON
                                posts.user_name = users.username
                            WHERE
                                title LIKE '%' || $1 || '%' AND hashtag && ARRAY[$2]`;

    const queryPostsUser = `SELECT
                                * 
                            FROM 
                                posts 
                            WHERE 
                                user_name = $1;`;

    const queryUser = `SELECT 
                            users.user_id,
                            users.username,
                            users.user_photo,
                            COUNT(followers.follower_id) AS num_followers
                        FROM 
                            users
                        LEFT JOIN 
                            followers ON users.user_id = followers.followed_id
                        WHERE 
                            users.username = $1
                        GROUP BY 
                        users.user_id, users.username, users.user_photo;`

        const followQuery = `WITH user_ids AS (
                                SELECT 
                                    username,
                                    user_id
                                FROM 
                                    users
                                WHERE 
                                    username IN ($1, $2)
                            )
                            INSERT INTO followers (follower_id, followed_id)
                            SELECT 
                                (SELECT user_id FROM user_ids WHERE username = $1) AS follower_id,
                                (SELECT user_id FROM user_ids WHERE username = $2) AS followed_id;`;                     

    const unfollowQuery = `WITH user_ids AS (
                                SELECT 
                                    username,
                                    user_id
                                FROM 
                                    users
                                WHERE 
                                    username IN ($1, $2)
                            )
                            DELETE FROM followers
                            WHERE 
                                follower_id = (SELECT user_id FROM user_ids WHERE username = $1)
                                AND followed_id = (SELECT user_id FROM user_ids WHERE username = $2);`;

    const getPostsByHashtag = `SELECT
                                    P.*,
                                    U.USER_PHOTO
                                FROM
                                    posts P
                                    JOIN users U ON p.user_name = U.username
                                WHERE
                                    hashtag @> ARRAY[$1] AND user_name = $2;`;

    const getQuery = `WITH user_ids AS (
                            SELECT 
                                username,
                                user_id
                            FROM 
                                users
                            WHERE 
                                username IN ($1, $2)
                        )
						SELECT 
						(SELECT user_id FROM user_ids WHERE username = $2) AS follower_id,
                            (SELECT user_id FROM user_ids WHERE username = $1) AS followed_id;`;

    const queryFollowUser = `SELECT 
                                EXISTS (
                                    SELECT 1
                                    FROM followers F
                                    JOIN users U1 ON F.follower_id = U1.user_id  
                                    JOIN users U2 ON F.followed_id = U2.user_id  
                                    WHERE 
                                        U1.username = $1  
                                        AND U2.username = $2
                                ) AS is_following;`;

    const queryFollowersView = `SELECT 
                                    U.username,
                                    U.user_photo
                                FROM 
                                    followers F
                                JOIN 
                                    users U ON F.follower_id = U.user_id  -- Obtener info de los seguidores
                                JOIN 
                                    users U2 ON F.followed_id = U2.user_id  -- Obtener user_id del usuario dado
                                WHERE 
                                    U2.username = $1; `;

// **Obtener todos los posts**
app.get('/posts', async (req, res) => {
    try {
        const { user } = req.query;
       

        const user_id = await pool.query("SELECT user_id FROM users WHERE username=$1;",
            [user]
        );
       
        const result = await pool.query(queryPosts,[user_id.rows[0]['user_id']])
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error obteniendo los posts' });
    }
});

app.get('/getFetch', async (req, res) => {
    try {
        const { title, hashtag } = req.query;

        if(title == '' && hashtag != ''){
            const _getPostsFetch1 = getPostsFetch1.replace(/\$1/g, `${hashtag}`);
            const result = await pool.query(_getPostsFetch1);
            res.status(200).json(result.rows);
        }else if(hashtag == '' && title != ''){
            const result = await pool.query(getPostsFetch2, [title]);
            res.status(200).json(result.rows);
        }else{
            console.log('entra3');
            const _getPostsFetch3 = getPostsFetch3.replace(/\$2/g, `${hashtag}`);
            const result = await pool.query(_getPostsFetch3, [title]);
            res.status(200).json(result.rows);
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error obteniendo los posts' });
    }
});

app.get('/postsUser', async (req, res) => {
    try {
        const { user } = req.query;
        
        const result = await pool.query(queryPostsUser,[user])
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error obteniendo los posts' });
    }
});

app.get('/getFollowers', async (req, res) => {
    try {
        const { user } = req.query;
        
        const result = await pool.query(queryFollowersView,[user])
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error obteniendo los posts' });
    }
});

app.get('/postsByHashtag', async (req, res) => {
    try {
        const { user, hashtag } = req.query;

        const result = await pool.query(getPostsByHashtag,
            [hashtag, user]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ 'Error obteniendo los posts': err});
    }
});

app.get('/post', async (req,res) => {

        
    try {

        const { user,postId } = req.query;
        
        const resultId = await pool.query("SELECT user_id, username FROM users WHERE username=$1;",
            [user]
        );
        const userId = resultId.rows[0]['user_id'];
        const result = await pool.query(`SELECT 
                                        users.user_photo, 
                                        posts.*, 
                                        users.username,
                                        CASE 
                                            WHEN followers.follower_id IS NOT NULL THEN true 
                                            ELSE false 
                                        END AS is_following
                                        FROM 
                                            posts
                                        JOIN 
                                            users ON posts.user_name = users.username
                                        LEFT JOIN 
                                            followers ON followers.follower_id = $2 
                                                    AND followers.followed_id = users.user_id
                                        WHERE 
                                        posts.id = $1;`,
            [postId,userId]
        )

        res.json(result.rows);
    } catch (err) {
        console.error('error: ', err);
        res.status(500).json({error: 'Error obtaining post'})
    }
});

app.get('/randomPost', async (req,res) => {
    try {
        const result = await pool.query("SELECT id FROM posts ORDER BY random() LIMIT 1;");
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error obteniendo los posts' });
    }
});

app.get('/users', async (req,res) => {
    try {

        const { user, email, password } = req.query;
        if(email == 'undefined'){
            const result = await pool.query("SELECT user_id, username FROM users WHERE username=$1 AND user_password=$2;",
                [user,password]
            );
            if(result.rowCount > 0) res.status(200).json(result.rows[0])
            else res.status(500).json({error:'Incorrect User or Password'})
        }else{
            const result = await pool.query("SELECT username FROM users WHERE email=$1;",
                [email]
            );
            if(result.rowCount > 0) res.status(500).json({error: 'Email registered'})
            else{
                const result = await pool.query("SELECT username FROM users WHERE username=$1;",
                    [user]
                );
                if(result.rowCount > 0) {res.status(500).json({error: 'User registered'})
                }else{
                    res.status(200).json({value: 'New User'})
                }
            }
            //res.json(result.rows);
        }
        
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error obteniendo los posts' });
    }
});

app.get('/userPhoto', async (req,res) => {
    try {
        const { user } = req.query;
        const result = await pool.query('SELECT user_photo FROM users WHERE username=$1;',[user]);
        res.status(200).json(result.rows[0]);
    }catch (err){
        console.error('error: ', err);
        res.status(500).json(err);
    }
});

app.get('/userProfile', async (req,res) => {
    try {
        const { user } = req.query;
        
        const result = await pool.query(queryUser,[user]);
        res.status(200).json(result.rows);
    }catch (err) {
        console.error(err);
        res.status(500).json({error: 'Error obtaining data'})
    }
});

app.get('/hashtags', async (req, res) => {
    try{
        const {user} = req.query;

        const result = await pool.query('SELECT DISTINCT ON (id) hashtag, id, title FROM posts WHERE user_name = $1',
            [user]
        );
        res.status(200).json(result.rows);
    } catch (err){
        console.error(err);
        res.status(500).json({'error': err});
    }
}); 

app.get('/follow', async (req,res) => {
    try{

        const { myUser, otherUser } = req.query();
        
        const result = await pool.query(getQuery,[myUser,otherUser]);
        res.status(200).json(result.rows);
    } catch (err){
        console.error('error: ', err);
        res.status(500).json(err);
    }
});

app.get('/follow2', async (req,res) => {
    try{

        const { myUser, otherUser } = req.query;
        const result = await pool.query(queryFollowUser,[myUser,otherUser]);
        res.status(200).json(result.rows);
    } catch (err){
        console.error('error: ', err);
        res.status(500).json(err);
    }
});



// **Generar URL firmada para subir imágenes**
app.post('/generate-upload-url', async (req, res) => {
    try {
        const { fileName, fileType } = req.body;

        if (!fileName || !fileType) {
            return res.status(400).json({ error: 'Faltan parámetros' });
        }

        const s3Params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `images/${Date.now()}-${fileName}`,
            ContentType: fileType,
            Expires: 60,
        };

        const uploadUrl = await s3.getSignedUrlPromise('putObject', s3Params);

        res.json({ uploadUrl, fileUrl: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Params.Key}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error generando la URL firmada' });
    }
});

// **Agregar un nuevo post**
app.post('/posts', async (req, res) => {
    try {
        const { id, user_name, title, description, score, hashtag, image} = req.body;

        // Verificar que los campos requeridos existen
        if (!id, !user_name || !title || !description || !score || !hashtag) {
            return res.status(400).json({ error: 'Faltan datos requeridos' });
        }

        const result = await pool.query(
            'INSERT INTO posts (id, user_name, title, description, score, hashtag, image) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [id, user_name, title, description, parseFloat(score), hashtag, image]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al agregar el post' });
    }
});

app.post('/users', async (req, res) => {
    try {
        const { user_id, username, email, user_password} = req.body;

        const result = await pool.query(
            'INSERT INTO users (user_id, username, email, user_password, user_photo) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [user_id, username, email, user_password, '']
        );
        res.status(201);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al agregar el user' });
    }
});

app.post('/follow', async (req, res) => {
    try{
        const { myUser, otherUser, isFollow} = req.body;

        if(isFollow){
            result = await pool.query(followQuery, [myUser, otherUser]);
            res.status(200).json(result.rows);
        }else{
            result = await pool.query(unfollowQuery, [myUser, otherUser]);
            res.status(200).json(result.rows);
        }

    } catch (err){
        console.error('error: ', err);
        res.status(500).json({error: 'Error obtaining data'});
    }
});


// **Iniciar el servidor**
app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});
