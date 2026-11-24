"use strict";

function fromList(skills) {

    return new Map(
        (skills || []).map(skill => [skill.name, skill])
    );

}


module.exports = {
    fromList
};
