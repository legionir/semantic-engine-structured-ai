using System;
using System.Collections.Generic;

namespace CSharpApi.Services
{
    public record WeatherForecast(DateTime Date, int TemperatureC, string Summary);

    public interface IWeatherService
    {
        IEnumerable<WeatherForecast> GetDailyForecast();
    }

    public class WeatherService : IWeatherService
    {
        public IEnumerable<WeatherForecast> GetDailyForecast()
        {
            return new List<WeatherForecast>
            {
                new(DateTime.Now, 22, "Sunny"),
                new(DateTime.Now.AddDays(1), 19, "Cloudy")
            };
        }
    }
}
