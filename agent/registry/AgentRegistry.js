"use strict";

function fromList(agents) {

    return new Map(
        (agents || []).map(agent => [agent.name, agent])
    );

}


module.exports = {
    fromList
};
