#include <iostream>
#include "../include/engine.hpp"

int main() {
    Core::Config cfg{4, "release"};
    Core::ComputeEngine engine(cfg);

    std::vector<int> numbers = {1, 2, 3, 4, 5};
    int total = engine.execute(numbers);

    std::cout << "Engine Result: " << total << std::endl;
    return 0;
}
