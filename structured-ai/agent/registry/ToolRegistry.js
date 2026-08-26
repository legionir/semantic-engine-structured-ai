"use strict";

function fromList(tools) {

    return new Map(
        (tools || [])
            .filter(item => item?.type === "function")
            .map(item => [item.function.name, item])
    );

}


module.exports = {
    fromList
};
