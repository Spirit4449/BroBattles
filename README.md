# Bro Battles

A real-time multiplayer browser-based battle arena game built with Phaser 3, Express, and Socket.IO. Challenge your friends in fast-paced PvP combat with multiple character classes and game modes!

## What is Bro Battles?

Bro Battles is a server-authoritative multiplayer action game where players can:

- Choose from multiple unique character classes (Draven, Ninja, Thorg, Wizard)
- Battle in different game modes (1v1, 2v2, 3v3)
- Fight on various maps (Lushy Peaks, Mangrove Meadow)
- Create or join parties with friends
- Experience smooth real-time combat with client-side interpolation

The game features a matchmaking system, party management, character progression, and an in-game economy for upgrades.

## Prerequisites

- **Node.js** (v14 or higher recommended)
- **MySQL** (v5.7 or higher)
- A modern web browser (Chrome, Firefox, Edge, Safari)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/Spirit4449/APCSP-Create-Project---Final.git
cd "Bro Battles"
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Database Setup

Create a MySQL database and run the migration scripts:

```sql
CREATE DATABASE game;
```

Then execute the migration files in order from `server/migrations/`:

- `2025-09-05_matchmaking.sql`
- `2025-09-06_party_status_enum.sql`

Refer to `database.md` for detailed schema information.

### 4. Environment Configuration

The server will auto-generate a `.cookie-secret` file on first run. You can optionally set these environment variables:

- `PORT` - Server port (default: 3002)
- `NODE_ENV` - Environment mode (development/production)
- `SECURE_COOKIES` - Set to `true` for HTTPS (default: false)
- `COOKIE_SECRET` - Custom cookie secret (auto-generated if not set)

### 5. Build and Run

**Development Mode:**

```bash
npm run dev
```

The server will start on `http://localhost:3002` with hot reloading.

**Production Mode:**

```bash
npm run build
npm start
```

## How to Play

### Getting Started

1. **Open Your Browser**

   - Navigate to `http://localhost:3002` (or your configured port)

2. **Create an Account** (Optional)

   - Click "Sign Up" to create a persistent account
   - Or continue as a guest (automatically created)

3. **Select Your Character**
   - Choose from available character classes:
     - **Draven**: Balanced melee fighter
     - **Ninja**: Fast, agile assassin
     - **Thorg**: Tank with high health
     - **Wizard**: Ranged magic caster

### Playing Solo

1. Click "Play" from the main menu
2. Select your game mode (1v1, 2v2, or 3v3)
3. Choose your map
4. Click "Ready" to join the matchmaking queue
5. Wait for other players to be matched
6. Accept the ready check when a match is found
7. Battle begins!

### Playing with Friends (Party Mode)

1. From the main menu, click "Create Party" or join an existing party
2. Share your party ID with friends
3. Wait for friends to join your party
4. As party leader, select:
   - Game mode
   - Map
   - Character class for yourself
5. All party members must click "Ready"
6. Party leader initiates matchmaking
7. Once a match is found, all players accept the ready check
8. Fight together as a team!

### In-Game Controls

- **Movement**: WASD or Arrow Keys
- **Attack**: Left Click or Spacebar
- **Special Abilities**: Character-specific (check in-game HUD)
- **Heal**: H key (if available)

### Combat Tips

- Each character has unique stats and abilities
- Pay attention to your health bar
- Use the environment and map features to your advantage
- Coordinate with teammates in team modes
- Time your attacks and abilities strategically

### Progression

- Win matches to earn currency
- Purchase character upgrades in the shop
- Level up your characters to unlock new abilities
- Track your stats and match history

## Game Features

- **Real-time Combat**: Server-authoritative gameplay with client-side prediction and interpolation
- **Matchmaking System**: Fair matching with ready-check confirmation
- **Party System**: Play with friends in private or public matches
- **Multiple Maps**: Each with unique layouts and strategic elements
- **Character Classes**: Diverse playstyles with unique abilities
- **Economy**: Earn and spend currency on character upgrades
- **Responsive Design**: Playable on desktop browsers

## Troubleshooting

**Connection Issues:**

- Ensure the server is running
- Check your firewall settings
- Verify MySQL is running and accessible

**Game Won't Start:**

- Clear browser cache and cookies
- Check browser console for errors (F12)
- Ensure all dependencies are installed

**Matchmaking Stuck:**

- Wait for other players to queue
- Try a different game mode
- Refresh and try again

## Technical Stack

- **Frontend**: Phaser 3 (game engine), vanilla JavaScript
- **Backend**: Node.js, Express
- **Real-time**: Socket.IO
- **Database**: MySQL with mysql2/promise
- **Build Tool**: Webpack 5
- **Authentication**: Signed cookies with guest support

## Development

Run the development server with hot reloading:

```bash
npm run dev
```

The project structure follows:

- `src/` - Client-side game code and server code
- `public/` - Static assets and HTML pages
- `src/server/` - Server-side logic (matchmaking, game rooms, routes)
- `server/migrations/` - Database migrations

## Contributing

Contributions are welcome! Please follow the existing code patterns and naming conventions outlined in `.github/copilot-instructions.md`.

## License

This project is an educational project for AP Computer Science Principles.

## Support

For issues or questions, please open an issue on the GitHub repository.

---

**Ready to battle? Launch the game and show your skills!** 🎮⚔️
