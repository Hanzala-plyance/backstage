using System;
using System.IO;
using UnityEngine;

namespace YARG.Helpers
{
    /// <summary>Shared contract with song-converter/songmaker/library.py.</summary>
    public static class BackstageLibrary
    {
        public static string SongsPath
        {
            get
            {
                var configured = Environment.GetEnvironmentVariable("BACKSTAGE_SONGS_DIR");
                if (!string.IsNullOrWhiteSpace(configured))
                {
                    configured = configured.Trim();
                    if (configured == "~" || configured.StartsWith("~/"))
                    {
                        configured = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                            configured.Length > 2 ? configured.Substring(2) : string.Empty);
                    }
                    return Path.GetFullPath(configured);
                }
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Music", "Backstage", "Songs");
            }
        }

        public static void OpenAddNewSong()
        {
            // Staff preparation service. Launch Add New Song/start.py before using this entry.
            Application.OpenURL("http://127.0.0.1:8765");
        }
    }
}
