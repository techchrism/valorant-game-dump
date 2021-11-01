# Valorant Game Dump

A script quickly written to do post-match analysis of a game and the players in that game

This is not intended to give any competitive advantage,
it only makes information accessible *after* a match for analysis purposes.

Currently, it gets:
 - presence data (used for party tracking) of players in the match
 - mmr details of each player
 - game details of the 6 most recent deathmatch games of each player
 - game details of the at-most 6 recent non-deathmatch games of each player
   - (there is no way I know of to specify "not deathmatch" so it gets the 6 most recent games and filters out the deathmatch ones)
 - game details of the just completed game

## Usage
Clone, install dependencies with `npm install` and run with `node index.js`

If your region is different from "na", you will need to change the constant defined in the code.
In the future, the client platform and client version may need to be changed.
